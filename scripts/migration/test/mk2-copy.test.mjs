import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  prepareCopy,
  writeCopies,
  checkCopies,
  importsOf,
  rewriteSource,
  importDeclarationManifest,
  applyImportDeclarationRewrites,
  validateImportDeclarationRewriteFinal,
  scopeDeclarationDigest,
  copyCli,
  safeRelative,
} from '../lib/mk2-copy.mjs'
import { MK2_PIN, sha256 } from '../lib/legacy-oracle.mjs'
import {
  assertM3TestDestination,
  canonicalM3Destination,
  isM3TestOwnedSource,
} from '../lib/sc2-m3-destinations.mjs'
import { parseSc2M3RefreezeArgs } from '../lib/sc2-m3-refreeze.mjs'

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

const topologyFromBlock =
  "import type { LocalContract } from './types.js'\n" + "import { alpha, beta } from './barrel.js'"
const topologyToBlock = "import { alpha } from './a.js'\nimport { beta } from './b.js'"
const topologyOriginal = `${topologyFromBlock}\nexport const result = alpha + beta\nexport type Result = LocalContract\n`
const topologyFinal = `${topologyToBlock}\ninterface LocalContract { value: number }\nexport const result = alpha + beta\nexport type Result = LocalContract\n`

function bindingIdentity(declaration, binding) {
  return JSON.stringify({
    kind: declaration.kind,
    form: binding.form,
    imported: binding.imported,
    local: binding.local,
    typeOnly: binding.typeOnly,
  })
}

function sortedRecords(records) {
  return records.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

function buildDeclarationRewrite({
  original = topologyOriginal,
  fromText = topologyFromBlock,
  toText = topologyToBlock,
  proof,
  reason = 'Exact binding-preserving topology fixture.',
}) {
  const fromDeclarations = importDeclarationManifest(fromText, 'fixture.ts')
  const toDeclarations = importDeclarationManifest(toText, 'fixture.ts', true)
  const sourceBindings = new Map()
  const destinationBindings = new Map()
  for (const declaration of fromDeclarations)
    for (const binding of declaration.bindings)
      sourceBindings.set(bindingIdentity(declaration, binding), {
        ...binding,
        kind: declaration.kind,
        moduleSpecifier: declaration.moduleSpecifier,
      })
  for (const declaration of toDeclarations)
    for (const binding of declaration.bindings)
      destinationBindings.set(bindingIdentity(declaration, binding), {
        ...binding,
        kind: declaration.kind,
        moduleSpecifier: declaration.moduleSpecifier,
      })
  const targetExceptions = []
  const typeElisions = []
  for (const [key, source] of sourceBindings) {
    const destination = destinationBindings.get(key)
    if (destination && source.moduleSpecifier !== destination.moduleSpecifier)
      targetExceptions.push({
        kind: source.kind,
        form: source.form,
        sourceSpecifier: source.moduleSpecifier,
        destinationSpecifier: destination.moduleSpecifier,
        imported: source.imported,
        local: source.local,
        typeOnly: source.typeOnly,
      })
    else if (!destination && source.typeOnly)
      typeElisions.push({
        kind: source.kind,
        form: source.form,
        sourceSpecifier: source.moduleSpecifier,
        imported: source.imported,
        local: source.local,
        typeOnly: source.typeOnly,
      })
  }
  return {
    mode: typeElisions.length ? 'type-only-elision' : 'binding-preserving',
    reason,
    proof: structuredClone(proof),
    from: {
      text: fromText,
      count: 1,
      sha256Before: sha256(original),
      declarations: fromDeclarations,
    },
    to: {
      text: toText,
      sha256After: sha256(original.replace(fromText, toText)),
      declarations: toDeclarations,
    },
    targetExceptions: sortedRecords(targetExceptions),
    typeElisions: sortedRecords(typeElisions),
  }
}

async function topologyFixture(t, { toBlock = topologyToBlock } = {}) {
  const f = await fixture(t)
  const files = new Map([
    ['src/main.ts', topologyOriginal],
    ['src/barrel.ts', 'export const alpha = 1\nexport const beta = 2\n'],
    ['src/types.ts', 'export interface LocalContract { value: number }\n'],
    ['src/a.ts', 'export const alpha = 1\n'],
    ['src/b.ts', 'export const beta = 2\n'],
  ])
  f.files.clear()
  for (const [file, text] of files) f.files.set(file, text)
  f.declaration.scopes['m1-libs'].requiredSources = [...files.keys()]
  f.declaration.copies = [...files].map(([file, text]) => ({
    source: file,
    destination: file.replace('src/', 'target/'),
    sha256Mk2: sha256(text),
    sha256Mk3: sha256(text),
    rewrites: [],
  }))
  const proofPath = 'proof/topology.md'
  const proofText = 'reviewed exact import topology fixture\n'
  await mkdir(path.join(f.root, 'proof'), { recursive: true })
  await writeFile(path.join(f.root, proofPath), proofText)
  const proof = [{ path: proofPath, sha256: sha256(proofText) }]
  const rewrite = buildDeclarationRewrite({ toText: toBlock, proof })
  const transformed = topologyOriginal.replace(topologyFromBlock, toBlock)
  const finalText = `${toBlock}\ninterface LocalContract { value: number }\nexport const result = alpha + beta\nexport type Result = LocalContract\n`
  const edit = {
    from: 'export const result = alpha + beta',
    to: 'interface LocalContract { value: number }\nexport const result = alpha + beta',
    count: 1,
    sha256Before: sha256(transformed),
    sha256After: sha256(finalText),
  }
  const main = f.declaration.copies[0]
  main.importDeclarationRewrites = [rewrite]
  main.sha256Mk3 = sha256(finalText)
  f.divergences.entries = [
    {
      file: main.destination,
      semantic: false,
      reason: 'The erased source contract is declared locally after the import topology split.',
      mk3Contract: 'Preserve the same compile-time LocalContract name and runtime behavior.',
      proof,
      edits: [edit],
    },
  ]
  return { ...f, proof, rewrite, transformed, finalText }
}

async function applyTopology(f, record, { original = topologyOriginal, finalText } = {}) {
  const rewritten = await applyImportDeclarationRewrites(original, [record], 'fixture.ts', f.root)
  validateImportDeclarationRewriteFinal(rewritten, finalText ?? f.finalText, 'fixture.ts')
  return rewritten
}

test('declaration-bound rewrite deterministically splits imports and preserves closure', async t => {
  const f = await topologyFixture(t)
  const prepared = await f.prepare()
  assert.equal(prepared.records[0].text, topologyFinal)
  assert.equal(prepared.records[0].importDeclarationRewrites.length, 1)
  assert.equal(prepared.provenance.files[0].importDeclarationRewrites.length, 1)
  assert.deepEqual(
    prepared.provenance.closure.map(edge => [edge.sourceTarget, edge.destinationTarget]),
    [
      ['src/barrel.ts', 'target/a.ts'],
      ['src/barrel.ts', 'target/b.ts'],
      ['src/types.ts', 'local-type:LocalContract'],
    ],
  )
  assert.equal(prepared.provenance.closure[0].binding.local, 'alpha')
  assert.equal(prepared.provenance.closure[0].targetException.destinationSpecifier, './a.js')
  assert.equal(prepared.provenance.closure[2].typeElision.local, 'LocalContract')
  await writeCopies(prepared)
  assert.equal((await checkCopies(await f.prepare())).files, 5)
})

test('declaration-bound negative 1: partial matches and counts other than one fail', async t => {
  const f = await topologyFixture(t)
  const wrongCount = structuredClone(f.rewrite)
  wrongCount.from.count = 2
  await assert.rejects(() => applyTopology(f, wrongCount), /Invalid declaration rewrite/u)

  const duplicatedText = `${topologyOriginal}${topologyFromBlock}\n`
  const duplicated = structuredClone(f.rewrite)
  duplicated.from.sha256Before = sha256(duplicatedText)
  await assert.rejects(
    () => applyTopology(f, duplicated, { original: duplicatedText }),
    /occurrence mismatch/u,
  )
})

test('declaration-bound negative 2: statements and unbound imports fail', () => {
  for (const invalid of [
    "import { alpha } from './a.js'; evil()",
    "const load = import('./a.js')",
    "const load = require('./a.js')",
    "import './a.js'",
    "export * from './a.js'",
  ])
    assert.throws(
      () => importDeclarationManifest(invalid, 'fixture.ts'),
      /non-static import\/export|Side-effect import|named re-export/u,
    )
})

test('declaration-bound rewrite cannot relocate a pragma comment', async t => {
  const f = await topologyFixture(t)
  const fromText = "// @ts-ignore\nimport { alpha } from './barrel.js'"
  const preservedToText = "// @ts-ignore\nimport { alpha } from './a.js'"
  const preservedOriginal = `${fromText}\nexport const value = alpha\n`
  const preserved = buildDeclarationRewrite({
    original: preservedOriginal,
    fromText,
    toText: preservedToText,
    proof: f.proof,
  })
  assert.equal(
    (await applyImportDeclarationRewrites(preservedOriginal, [preserved], 'fixture.ts', f.root))
      .text,
    preservedOriginal.replace(fromText, preservedToText),
  )

  const toText = "import { alpha } from './barrel.js'\n// @ts-ignore"
  const original = preservedOriginal
  const record = buildDeclarationRewrite({ original, fromText, toText, proof: f.proof })
  await assert.rejects(
    () => applyImportDeclarationRewrites(original, [record], 'fixture.ts', f.root),
    /comment (binding|trivia)/u,
  )
})

test('declaration-bound negative 3: binding additions, removals and identity changes fail', async t => {
  const f = await topologyFixture(t)
  const replacements = [
    "import { alpha, gamma } from './a.js'\nimport { beta } from './b.js'",
    "import { alpha } from './a.js'",
    "import { alpha as renamed } from './a.js'\nimport { beta } from './b.js'",
    "import { alpha } from './a.js'\nimport { alpha, beta } from './b.js'",
    "import type { alpha } from './a.js'\nimport { beta } from './b.js'",
  ]
  for (const replacement of replacements) {
    const record = buildDeclarationRewrite({ toText: replacement, proof: f.proof })
    await assert.rejects(
      () => applyTopology(f, record),
      /added or changed a binding|Runtime import removal|Duplicate declaration binding/u,
    )
  }
})

test('declaration-bound negative 4: target exceptions must be exact and unique', async t => {
  const f = await topologyFixture(t)
  const missing = structuredClone(f.rewrite)
  missing.targetExceptions.pop()
  await assert.rejects(() => applyTopology(f, missing), /target exceptions mismatch/u)

  const wildcard = structuredClone(f.rewrite)
  wildcard.targetExceptions[0].destinationSpecifier = '*'
  await assert.rejects(() => applyTopology(f, wildcard), /Invalid target exception/u)

  const duplicate = structuredClone(f.rewrite)
  duplicate.targetExceptions.push(structuredClone(duplicate.targetExceptions[0]))
  await assert.rejects(
    () => applyTopology(f, duplicate),
    /Duplicate declaration rewrite target exceptions/u,
  )

  const unused = structuredClone(f.rewrite)
  unused.targetExceptions.push({ ...unused.targetExceptions[0], local: 'unused' })
  await assert.rejects(() => applyTopology(f, unused), /target exceptions mismatch/u)
})

test('declaration-bound negative 5: unresolved and outside-closure targets fail', async t => {
  const missingBlock = "import { alpha } from './missing.js'\nimport { beta } from './b.js'"
  const missing = await topologyFixture(t, { toBlock: missingBlock })
  await assert.rejects(missing.prepare, /Unresolved copied relative import/u)

  const outside = await topologyFixture(t)
  outside.declaration.scopes['m1-libs'].requiredSources = outside.declaration.scopes[
    'm1-libs'
  ].requiredSources.filter(file => file !== 'src/a.ts')
  await assert.rejects(outside.prepare, /Unresolved copied relative import/u)
})

test('declaration-bound negative 6: runtime import removal fails', async t => {
  const f = await topologyFixture(t)
  const original = "import { alpha } from './barrel.js'\nexport const value = alpha\n"
  const record = buildDeclarationRewrite({
    original,
    fromText: "import { alpha } from './barrel.js'",
    toText: '',
    proof: f.proof,
  })
  await assert.rejects(
    () => applyTopology(f, record, { original, finalText: 'export const value = alpha\n' }),
    /Runtime import removal/u,
  )
})

test('declaration-bound negative 7: unsafe type elision fails', async t => {
  const f = await topologyFixture(t)
  const rewritten = await applyImportDeclarationRewrites(
    topologyOriginal,
    [f.rewrite],
    'fixture.ts',
    f.root,
  )
  assert.throws(
    () =>
      validateImportDeclarationRewriteFinal(
        rewritten,
        `${topologyFinal}console.log(LocalContract)\n`,
        'fixture.ts',
      ),
    /value-position reference/u,
  )
  assert.throws(
    () =>
      validateImportDeclarationRewriteFinal(
        rewritten,
        topologyFinal.replace('interface LocalContract', 'interface Other'),
        'fixture.ts',
      ),
    /lacks same-name local declaration/u,
  )

  const forged = structuredClone(f.rewrite)
  forged.from.declarations[0].bindings[0].typeOnly = false
  await assert.rejects(() => applyTopology(f, forged), /Source declaration manifest mismatch/u)

  const markerOriginal = "import type { LocalContract } from './types.js'\nconst value = 1\n"
  const markerRecord = buildDeclarationRewrite({
    original: markerOriginal,
    fromText: "import type { LocalContract } from './types.js'",
    toText: '',
    proof: f.proof,
  })
  await assert.rejects(
    () =>
      applyTopology(f, markerRecord, {
        original: markerOriginal,
        finalText: 'interface LocalContract { value: number }\nconst value = 1\n',
      }),
    /changes emitted runtime/u,
  )
})

test('declaration-bound negative 8: phase, proof and final hashes fail independently', async t => {
  const f = await topologyFixture(t)
  const before = structuredClone(f.rewrite)
  before.from.sha256Before = '0'.repeat(64)
  await assert.rejects(() => applyTopology(f, before), /before hash mismatch/u)

  const after = structuredClone(f.rewrite)
  after.to.sha256After = '0'.repeat(64)
  await assert.rejects(() => applyTopology(f, after), /result hash mismatch/u)

  const proof = structuredClone(f.rewrite)
  proof.proof[0].sha256 = '0'.repeat(64)
  await assert.rejects(() => applyTopology(f, proof), /proof hash mismatch/u)

  f.declaration.copies[0].sha256Mk3 = '0'.repeat(64)
  await assert.rejects(f.prepare, /Declared destination hash mismatch/u)
})

test('declaration-bound negative 9: target exceptions cannot bypass closure', async t => {
  const f = await topologyFixture(t)
  assert.equal(
    f.rewrite.targetExceptions.some(item => item.destinationSpecifier === './a.js'),
    true,
  )
  f.declaration.copies.find(row => row.source === 'src/a.ts').destination = 'target/elsewhere.ts'
  await assert.rejects(f.prepare, /Unresolved copied relative import/u)
})

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

test('import relocation changes only AST import literals when prose repeats the same text', () => {
  const source = "import value from '../src/value.js'\ndescribe('../src/value.js', () => value)\n"
  const result = rewriteSource(
    source,
    [{ from: "'../src/value.js'", to: "'../../src/value.js'", count: 1 }],
    'value.test.ts',
  )
  assert.equal(
    result.text,
    "import value from '../../src/value.js'\ndescribe('../src/value.js', () => value)\n",
  )
})

test('canonical relative source may use its direct public package export, never a replacement', async t => {
  const f = await fixture(t)
  const row = f.declaration.copies[0]
  row.rewrites = [{ from: "'./value.js'", to: "'@fixture/kit/value'", count: 1 }]
  row.sha256Mk3 = sha256(f.files.get(row.source).replace('./value.js', '@fixture/kit/value'))
  f.declaration.copies[1].destination = 'kit/src/value.ts'
  const metadata = {
    name: '@fixture/kit',
    version: '1.0.0',
    exports: {
      './value': {
        types: './dist/value.d.ts',
        default: './dist/value.js',
      },
    },
  }
  await mkdir(path.join(f.root, 'kit/src'), { recursive: true })
  await writeFile(path.join(f.root, 'kit/package.json'), JSON.stringify(metadata))
  await writeFile(
    path.join(f.root, 'kit/tsconfig.json'),
    JSON.stringify({
      compilerOptions: { rootDir: 'src', outDir: 'dist' },
      include: ['src/**/*.ts'],
    }),
  )
  const dependency = {
    specifier: '@fixture/kit/value',
    package: '@fixture/kit',
    version: '1.0.0',
    manifest: 'kit/package.json',
    manifestSha256: sha256(JSON.stringify(metadata)),
    reason: 'Single canonical source through its public export',
    canonicalSources: ['src/value.ts'],
  }
  f.declaration.scopes['m1-libs'].dependencies = [dependency]
  const prepared = await f.prepare()
  assert.equal(prepared.provenance.closure[0].destinationTarget, 'kit/src/value.ts')
  await writeCopies(prepared)
  await checkCopies(await f.prepare())
  delete dependency.manifestSha256
  await assert.rejects(f.prepare(), /Unpinned dependency manifest/u)
  dependency.manifestSha256 = sha256(JSON.stringify(metadata))
  metadata.description = 'same identity, changed manifest bytes'
  await writeFile(path.join(f.root, 'kit/package.json'), JSON.stringify(metadata))
  await assert.rejects(f.prepare(), /Dependency manifest hash mismatch/u)
  delete metadata.description
  await writeFile(path.join(f.root, 'kit/package.json'), JSON.stringify(metadata))
  dependency.canonicalSources = []
  await assert.rejects(f.prepare(), /replaced by bare dependency/u)
  dependency.canonicalSources = ['src/value.ts']
  metadata.exports['./value'].default = './dist/other.js'
  await writeFile(path.join(f.root, 'kit/package.json'), JSON.stringify(metadata))
  dependency.manifestSha256 = sha256(JSON.stringify(metadata))
  await assert.rejects(f.prepare(), /Noncanonical package export target/u)
  metadata.exports['./value'].default = './dist/value.js'
  metadata.exports['./value'].browser = './dist/browser-substitute.js'
  await writeFile(path.join(f.root, 'kit/package.json'), JSON.stringify(metadata))
  dependency.manifestSha256 = sha256(JSON.stringify(metadata))
  await assert.rejects(f.prepare(), /Noncanonical package export target/u)
})

test('exact copied-unwired disposition may redirect an excluded relative source to a dependency', async t => {
  const f = await fixture(t)
  const row = f.declaration.copies[0]
  const rewritten = f.files.get(row.source).replace('./value.js', 'node:path')
  row.rewrites = [{ from: "'./value.js'", to: "'node:path'", count: 1 }]
  row.sha256Mk3 = sha256(rewritten)
  f.declaration.scopes['m1-libs'].dependencies = [
    { specifier: 'node:path', kind: 'node-builtin', reason: 'Exact test dependency.' },
  ]
  f.declaration.scopes['m1-libs'].importDispositions = [
    {
      source: 'src/main.ts',
      specifier: './value.js',
      destinationSpecifier: 'node:path',
      kind: 'copied-unwired',
      count: 1,
      reason: 'The excluded legacy source is replaced by a reviewed dependency boundary.',
    },
  ]
  const prepared = await f.prepare()
  assert.equal(prepared.provenance.closure[0].destinationTarget, 'copied-unwired:node:path')
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

test('copied-unwired imports require exact source, specifier, count and reason', async t => {
  const f = await fixture(t)
  const text = "import 'legacy-codec'\n"
  f.files.set('src/value.ts', text)
  Object.assign(f.declaration.copies[1], { sha256Mk2: sha256(text), sha256Mk3: sha256(text) })
  const selected = f.declaration.scopes['m1-libs']
  selected.importDispositions = [
    {
      source: 'src/value.ts',
      specifier: 'legacy-codec',
      kind: 'copied-unwired',
      count: 1,
      reason: 'Compatibility copy is deliberately excluded from production and C1 compilation.',
    },
  ]
  const prepared = await f.prepare()
  assert.equal(prepared.provenance.closure[1].destinationTarget, 'copied-unwired:legacy-codec')
  assert.equal(prepared.provenance.closure[1].disposition.kind, 'copied-unwired')
  selected.importDispositions[0].count = 2
  await assert.rejects(f.prepare, /Import disposition count mismatch/u)
  selected.importDispositions[0].count = 1
  selected.importDispositions[0].reason = ''
  await assert.rejects(f.prepare, /Invalid import disposition/u)
})

test('copied-unwired bare disposition cannot authorize a rewritten target implicitly', async t => {
  const f = await fixture(t)
  const text = "import 'legacy-codec'\n"
  f.files.set('src/value.ts', text)
  f.declaration.copies[1] = {
    ...f.declaration.copies[1],
    sha256Mk2: sha256(text),
    sha256Mk3: sha256("import 'other-unwired'\n"),
    rewrites: [{ from: "'legacy-codec'", to: "'other-unwired'", count: 1 }],
  }
  f.declaration.scopes['m1-libs'].importDispositions = [
    {
      source: 'src/value.ts',
      specifier: 'legacy-codec',
      kind: 'copied-unwired',
      count: 1,
      reason: 'Original legacy edge only.',
    },
  ]
  await assert.rejects(f.prepare, /Import disposition destination mismatch/u)
  f.declaration.scopes['m1-libs'].importDispositions[0].destinationSpecifier = 'other-unwired'
  const prepared = await f.prepare()
  assert.equal(prepared.provenance.closure[1].destinationTarget, 'copied-unwired:other-unwired')
})

test('computed imports can only remain in copied-unwired source through an exact expression disposition', async t => {
  const f = await fixture(t)
  const text = 'const moduleName = "legacy"\nexport const load = () => import(moduleName)\n'
  f.files.set('src/value.ts', text)
  Object.assign(f.declaration.copies[1], { sha256Mk2: sha256(text), sha256Mk3: sha256(text) })
  const selected = f.declaration.scopes['m1-libs']
  selected.importDispositions = [
    {
      source: 'src/value.ts',
      expression: 'moduleName',
      kind: 'copied-unwired',
      count: 1,
      reason: 'The computed loader is retained for provenance outside production compilation.',
    },
  ]
  const prepared = await f.prepare()
  assert.equal(
    prepared.provenance.closure[1].destinationTarget,
    'copied-unwired:expression:moduleName',
  )
  selected.importDispositions[0].destinationSpecifier = 'other'
  await assert.rejects(f.prepare, /Invalid import disposition/u)
})

test('cross-codec relative imports must be recorded as copied-unwired', async t => {
  const f = await fixture(t)
  const sourceA = 'extensions/blizzard/starcraft-2/codecs/a/src/main.ts'
  const sourceB = 'extensions/blizzard/starcraft-2/codecs/b/src/value.ts'
  const textA = "import type { Value } from '../../b/src/value.js'\nexport type A = Value\n"
  const textB = 'export type Value = number\n'
  f.files.clear()
  f.files.set(sourceA, textA)
  f.files.set(sourceB, textB)
  const selected = f.declaration.scopes['m1-libs']
  selected.requiredSources = [sourceA, sourceB]
  f.declaration.copies = [
    {
      source: sourceA,
      destination: 'target/codecs/a/src/main.ts',
      sha256Mk2: sha256(textA),
      sha256Mk3: sha256(textA),
      rewrites: [],
    },
    {
      source: sourceB,
      destination: 'target/codecs/b/src/value.ts',
      sha256Mk2: sha256(textB),
      sha256Mk3: sha256(textB),
      rewrites: [],
    },
  ]
  await assert.rejects(f.prepare, /Cross-codec import needs copied-unwired disposition/u)
  selected.importDispositions = [
    {
      source: sourceA,
      specifier: '../../b/src/value.js',
      kind: 'copied-unwired',
      count: 1,
      reason: 'Pinned codec edge is retained only in the isolated compatibility tree.',
    },
  ]
  const prepared = await f.prepare()
  assert.equal(prepared.provenance.closure[0].disposition.kind, 'copied-unwired')
})

test('copied-unwired disposition can preserve a relative edge outside the admitted copy unit', async t => {
  const f = await fixture(t)
  const text = "export { legacy } from './legacy.js'\n"
  f.files.set('src/value.ts', text)
  f.files.set('src/legacy.ts', 'export const legacy = true\n')
  Object.assign(f.declaration.copies[1], { sha256Mk2: sha256(text), sha256Mk3: sha256(text) })
  f.declaration.scopes['m1-libs'].importDispositions = [
    {
      source: 'src/value.ts',
      specifier: './legacy.js',
      kind: 'copied-unwired',
      count: 1,
      reason: 'The source-only edge stays visible while its separate owner milestone is pending.',
    },
  ]
  const prepared = await f.prepare()
  assert.equal(prepared.provenance.closure[1].sourceTarget, 'src/legacy.ts')
  assert.equal(prepared.provenance.closure[1].destinationTarget, 'copied-unwired:./legacy.js')
})

test('copied-unwired disposition records a pinned unresolved relative edge exactly', async t => {
  const f = await fixture(t)
  const text = "export { missing } from './missing.js'\n"
  f.files.set('src/value.ts', text)
  Object.assign(f.declaration.copies[1], { sha256Mk2: sha256(text), sha256Mk3: sha256(text) })
  f.declaration.scopes['m1-libs'].importDispositions = [
    {
      source: 'src/value.ts',
      specifier: './missing.js',
      kind: 'copied-unwired',
      count: 1,
      reason: 'The pinned source already contains this unresolved compatibility-only edge.',
    },
  ]
  const prepared = await f.prepare()
  assert.equal(prepared.provenance.closure[1].sourceTarget, null)
  assert.equal(prepared.provenance.closure[1].destinationTarget, 'copied-unwired:./missing.js')
})

test('relative copied-unwired disposition binds the relocated destination specifier', async t => {
  const f = await fixture(t)
  const sourceA = 'extensions/blizzard/starcraft-2/codecs/a/src/main.ts'
  const sourceB = 'extensions/blizzard/starcraft-2/codecs/b/src/value.ts'
  const textA = "export { value } from '../../b/src/value.js'\n"
  const textB = 'export const value = 1\n'
  f.files.clear()
  f.files.set(sourceA, textA)
  f.files.set(sourceB, textB)
  f.declaration.scopes['m1-libs'].requiredSources = [sourceA, sourceB]
  f.declaration.copies = [
    {
      source: sourceA,
      destination: 'target/a/main.ts',
      sha256Mk2: sha256(textA),
      sha256Mk3: sha256("export { value } from '../b/value.js'\n"),
      rewrites: [{ from: "'../../b/src/value.js'", to: "'../b/value.js'", count: 1 }],
    },
    {
      source: sourceB,
      destination: 'target/b/value.ts',
      sha256Mk2: sha256(textB),
      sha256Mk3: sha256(textB),
      rewrites: [],
    },
  ]
  const disposition = {
    source: sourceA,
    specifier: '../../b/src/value.js',
    kind: 'copied-unwired',
    count: 1,
    reason: 'Cross-codec compatibility edge.',
  }
  f.declaration.scopes['m1-libs'].importDispositions = [disposition]
  await assert.rejects(f.prepare, /Import disposition destination mismatch/u)
  disposition.destinationSpecifier = '../b/value.js'
  const prepared = await f.prepare()
  assert.equal(prepared.provenance.closure[0].destinationSpecifier, '../b/value.js')
})

test('bounded divergence may preserve an isolated noncanonical overlap', async t => {
  const f = await fixture(t)
  const sourceMain = "export { value } from './value.js'\n"
  const rewrittenMain = "export { value } from '../core/value.js'\n"
  const proof = 'proof.test.ts'
  await writeFile(path.join(f.root, proof), 'assert.equal(isolatedSuites, 6)')
  f.files.set('src/main.ts', sourceMain)
  f.declaration.copies[0] = {
    source: 'src/main.ts',
    destination: 'target/archive/main.ts',
    sha256Mk2: sha256(sourceMain),
    sha256Mk3: sha256(sourceMain),
    rewrites: [{ from: "'./value.js'", to: "'../core/value.js'", count: 1 }],
  }
  f.declaration.copies[1].destination = 'target/core/value.ts'
  f.declaration.scopes['m1-libs'].importDispositions = [
    {
      source: 'src/main.ts',
      specifier: './value.js',
      kind: 'copied-unwired',
      count: 1,
      reason: 'The bounded divergence retains an isolated duplicate of the canonical source.',
    },
  ]
  f.divergences.entries.push({
    file: 'target/archive/main.ts',
    semantic: true,
    reason: 'The test-only tree exercises its isolated overlap.',
    mk3Contract: 'Production registration remains unchanged.',
    ownerDecision: 'Execute the exact isolated compatibility suite.',
    proof: [{ path: proof, sha256: sha256('assert.equal(isolatedSuites, 6)') }],
    edits: [
      {
        from: "'../core/value.js'",
        to: "'./value.js'",
        count: 1,
        sha256Before: sha256(rewrittenMain),
        sha256After: sha256(sourceMain),
      },
    ],
  })
  const prepared = await f.prepare()
  assert.equal(prepared.provenance.closure[0].destinationTarget, 'copied-unwired:./value.js')
  assert.equal(prepared.provenance.files[0].sha256Mk2, prepared.provenance.files[0].sha256Mk3)
  assert.equal(prepared.provenance.files[0].rewrites.length, 1)
  assert.equal(prepared.provenance.files[0].divergence.edits.length, 1)
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

test('dry-run preflight may validate pending M3 without making copy/check accept it', async t => {
  const f = await fixture(t)
  f.declaration.scopes['m1-libs'].status = 'pending-m3'
  await assert.rejects(f.prepare, /remains pending/u)
  const prepared = await prepareCopy({ ...f.options, allowPending: true })
  assert.equal(prepared.records.length, 2)
})

test('scope declaration digest ignores future scopes but binds accepted scope config and copy rows', async t => {
  const f = await fixture(t)
  const rows = f.declaration.copies
  const before = scopeDeclarationDigest(f.declaration, 'm1-libs', rows)
  f.declaration.scopes.future = { status: 'pending-future', requiredSources: ['future.ts'] }
  assert.equal(scopeDeclarationDigest(f.declaration, 'm1-libs', rows), before)
  f.declaration.scopes['m1-libs'].note = 'mutated accepted scope'
  assert.notEqual(scopeDeclarationDigest(f.declaration, 'm1-libs', rows), before)
  delete f.declaration.scopes['m1-libs'].note
  const mutatedRows = structuredClone(rows)
  mutatedRows[0].sha256Mk3 = '0'.repeat(64)
  assert.notEqual(scopeDeclarationDigest(f.declaration, 'm1-libs', mutatedRows), before)
})

test('prepareCopy rejects unknown and mutated accepted scope pins', async () => {
  const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  const declaration = JSON.parse(
    await readFile(path.join(workspaceRoot, 'modkit-core/migration/mk2-copy/sc2.json'), 'utf8'),
  )
  const divergences = JSON.parse(
    await readFile(
      path.join(workspaceRoot, 'modkit-core/migration/mk2-divergence/sc2.json'),
      'utf8',
    ),
  )
  const options = {
    divergences,
    scope: 'm1-libs',
    workspaceRoot,
    repoRoot: path.join(workspaceRoot, 'references/modkitmk2'),
  }
  const unknown = structuredClone(declaration)
  unknown.scopes['m1-libs'].acceptancePin = 'unknown-pin'
  await assert.rejects(
    prepareCopy({ ...options, declaration: unknown }),
    /Accepted scope pin mismatch/u,
  )
  const changedScope = structuredClone(declaration)
  changedScope.scopes['m1-libs'].note = 'mutated accepted scope'
  await assert.rejects(
    prepareCopy({ ...options, declaration: changedScope }),
    /Accepted scope pin mismatch/u,
  )
  const changedRow = structuredClone(declaration)
  const first = changedRow.scopes['m1-libs'].requiredSources[0]
  changedRow.copies.find(row => row.source === first).sha256Mk3 = '0'.repeat(64)
  await assert.rejects(
    prepareCopy({ ...options, declaration: changedRow }),
    /Accepted scope pin mismatch/u,
  )
})

test('M3 destination normalization cannot preserve a mutated current copy destination', () => {
  const renderingSpec = 'packages/rendering-3d/src/scene-core/terrain/render.spec.ts'
  const renderingFixture =
    'packages/rendering-3d/src/scene-core/terrain/fixtures/terrain-golden.png'
  const triggerTmp =
    'extensions/blizzard/starcraft-2/codecs/sc2-triggers/src/core/to-engine.e2e.spec.ts.tmp'
  for (const source of [renderingSpec, renderingFixture, triggerTmp]) {
    assert.equal(isM3TestOwnedSource(source), true)
    const mutated = {
      source,
      destination: `modkit-extensions-blizzard/starcraft2/src/lib/mk2/${path.basename(source)}`,
    }
    assert.throws(
      () => assertM3TestDestination(mutated.source, mutated.destination),
      /Test-owned blob placed under src\/lib/u,
    )
    const normalized = { ...mutated, destination: canonicalM3Destination(mutated.source) }
    assert.notDeepEqual(normalized, mutated)
    assert.doesNotThrow(() => assertM3TestDestination(normalized.source, normalized.destination))
  }
})

test('real M3 declaration keeps every selected test artifact outside src/lib', async () => {
  const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  const declaration = JSON.parse(
    await readFile(path.join(workspaceRoot, 'modkit-core/migration/mk2-copy/sc2.json'), 'utf8'),
  )
  const testOwned = declaration.copies.filter(row => isM3TestOwnedSource(row.source))
  assert.ok(testOwned.length > 0)
  assert.deepEqual(
    testOwned.filter(row => row.destination.includes('/src/lib/mk2/')),
    [],
  )
  assert.equal(
    declaration.copies.find(row => row.source.endsWith('/to-engine.e2e.spec.ts.tmp'))?.destination,
    'modkit-extensions-blizzard/starcraft2/test/mk2/codecs/sc2-triggers/src/core/to-engine.e2e.spec.ts.tmp',
  )
})

test('family dry-run rejects a consistently removed row and a mutated destination', async () => {
  const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  const declaration = JSON.parse(
    await readFile(path.join(workspaceRoot, 'modkit-core/migration/mk2-copy/sc2.json'), 'utf8'),
  )
  const divergences = JSON.parse(
    await readFile(
      path.join(workspaceRoot, 'modkit-core/migration/mk2-divergence/sc2.json'),
      'utf8',
    ),
  )
  const options = {
    divergences,
    scope: 'family',
    workspaceRoot,
    repoRoot: path.join(workspaceRoot, 'references/modkitmk2'),
    allowPending: true,
  }
  const source = 'packages/rendering-3d/src/scene.ts'
  const alternatePin = structuredClone(declaration)
  alternatePin.scopes.family.refreezePin =
    'modkit-core/migration/mk2-copy/alternate-self-authored.json'
  await assert.rejects(
    prepareCopy({ ...options, declaration: alternatePin }),
    /canonical tracked M3 refreeze pin/u,
  )
  const manuallyAdmitted = structuredClone(declaration)
  assert.equal(manuallyAdmitted.scopes.family.status, 'ready')
  manuallyAdmitted.scopes.family.status = 'pending-m3'
  await assert.rejects(
    prepareCopy({ ...options, declaration: manuallyAdmitted }),
    /Family refreeze pin mismatch/u,
  )
  const unknownStatus = structuredClone(declaration)
  unknownStatus.scopes.family.status = 'manually-admitted'
  await assert.rejects(
    prepareCopy({ ...options, declaration: unknownStatus }),
    /Family refreeze pin mismatch/u,
  )
  const removed = structuredClone(declaration)
  removed.scopes.family.requiredSources = removed.scopes.family.requiredSources.filter(
    item => item !== source,
  )
  removed.copies = removed.copies.filter(row => row.source !== source)
  await assert.rejects(
    prepareCopy({ ...options, declaration: removed }),
    /Family refreeze pin mismatch/u,
  )
  const relocated = structuredClone(declaration)
  relocated.copies.find(row => row.source === source).destination =
    'modkit-extensions-blizzard/starcraft2/src/lib/mk2/tampered-scene.ts'
  await assert.rejects(
    prepareCopy({ ...options, declaration: relocated }),
    /Family refreeze pin mismatch/u,
  )
})

test('M3 refreeze CLI requires an explicit paired ready admission', () => {
  assert.deepEqual(parseSc2M3RefreezeArgs([]), { writePin: false, admitReady: false })
  assert.deepEqual(parseSc2M3RefreezeArgs(['--write-pin']), {
    writePin: true,
    admitReady: false,
  })
  assert.deepEqual(parseSc2M3RefreezeArgs(['--admit-ready', '--write-pin']), {
    writePin: true,
    admitReady: true,
  })
  assert.deepEqual(parseSc2M3RefreezeArgs(['--write-pin', '--admit-ready']), {
    writePin: true,
    admitReady: true,
  })
  assert.throws(
    () => parseSc2M3RefreezeArgs(['--admit-ready']),
    /requires the explicit --write-pin/u,
  )
  assert.throws(() => parseSc2M3RefreezeArgs(['--unknown']), /paired/u)
  assert.throws(() => parseSc2M3RefreezeArgs(['--write-pin', '--write-pin']), /paired/u)
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
  const exported = rewriteSource(
    "export { RuntimeValue, TypeValue } from './value.js'",
    [
      {
        kind: 'export-type',
        from: "export { RuntimeValue, TypeValue } from './value.js'",
        to: "export { RuntimeValue, type TypeValue } from './value.js'",
      },
    ],
    'source.ts',
  )
  assert.equal(exported.text, "export { RuntimeValue, type TypeValue } from './value.js'")
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
