import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  algorithmDefinitions,
  scanAlgorithms,
  checkAlgorithmDebt,
  checkBaselineRatchet,
  checkMpqHashCanonicalization,
  ratchetAlgorithmSnapshot,
  sc2RuntimeSurfaceRoots,
  SC2_ALGORITHM_PRODUCTION_TSCONFIG,
  validateCopiedUnwiredAllowanceIds,
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

async function mpqHashFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mpq-hash-gate-test-'))
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir())
    assert.ok(path.basename(root).startsWith('mpq-hash-gate-test-'))
    await rm(root, { recursive: true, force: true })
  })
  const canonicalPath = 'modkit-core/packages/codec-kit/src/crypto/mpq.ts'
  const canonicalSource = await readFile(
    new URL('../../../packages/codec-kit/src/crypto/mpq.ts', import.meta.url),
    'utf8',
  )
  await mkdir(path.dirname(path.join(root, canonicalPath)), { recursive: true })
  await writeFile(path.join(root, canonicalPath), canonicalSource)
  const consumers = [
    'modkit-extensions-blizzard/mpq/src/mpq/codec.js',
    'modkit-extensions-blizzard/mpq/src/mpq/fresh-writer.js',
    'modkit-extensions-blizzard/mpq/src/mpq/native-preserving.js',
  ]
  for (const consumer of consumers) {
    await mkdir(path.dirname(path.join(root, consumer)), { recursive: true })
    await writeFile(
      path.join(root, consumer),
      "import { mpqHash } from '@modkit/codec-kit/crypto'\nexport const value = mpqHash('x', 1)\n",
    )
  }
  await mkdir(path.join(root, 'modkit-extensions-blizzard/starcraft2/src'), {
    recursive: true,
  })
  await writeFile(
    path.join(root, 'modkit-extensions-blizzard/starcraft2/src/index.ts'),
    'export const active = true\n',
  )
  const options = {
    workspaceRoot: root,
    repositories: ['modkit-core', 'modkit-extensions-blizzard'],
    canonicalFiles: [
      {
        mk2Path: 'packages/archives-processing/src/lib/crypto/index.ts',
        destination: canonicalPath,
        sha256Mk3: sha256(canonicalSource),
      },
    ],
  }
  return { root, consumers, options }
}

test('M4 mpqHash gate proves one canonical definition, three bindings and behavior vectors', async t => {
  const fixture = await mpqHashFixture(t)
  const current = await scanAlgorithms(fixture.options)
  assert.deepEqual(await checkMpqHashCanonicalization({ current, workspaceRoot: fixture.root }), {
    definitions: 1,
    blizzardDefinitions: 0,
    bindings: 3,
    vectors: 5,
  })
})

test('M4 mpqHash gate rejects a Blizzard definition hidden behind otherwise valid imports', async t => {
  const fixture = await mpqHashFixture(t)
  const peer = 'modkit-extensions-blizzard/mpq/src/mpq/peer.js'
  await writeFile(path.join(fixture.root, peer), 'export function mpqHash() { return 0 }\n')
  const current = await scanAlgorithms(fixture.options)
  await assert.rejects(
    () => checkMpqHashCanonicalization({ current, workspaceRoot: fixture.root }),
    /expected zero Blizzard mpqHash definitions/u,
  )
})

test('M4 mpqHash gate rejects an alias import with different behavior', async t => {
  const fixture = await mpqHashFixture(t)
  await writeFile(
    path.join(fixture.root, 'modkit-extensions-blizzard/starcraft2/src/alternate.ts'),
    "import { otherHash as mpqHash } from './different.js'\nexport const value = mpqHash('x', 1)\n",
  )
  const current = await scanAlgorithms(fixture.options)
  await assert.rejects(
    () => checkMpqHashCanonicalization({ current, workspaceRoot: fixture.root }),
    /non-canonical mpqHash binding/u,
  )
})

test('M4 mpqHash gate rejects a local alias that shadows the canonical import', async t => {
  const fixture = await mpqHashFixture(t)
  await writeFile(
    path.join(fixture.root, fixture.consumers[0]),
    "import { mpqHash } from '@modkit/codec-kit/crypto'\nexport const value = (mpqHash) => mpqHash('x', 1)\n",
  )
  const current = await scanAlgorithms(fixture.options)
  await assert.rejects(
    () => checkMpqHashCanonicalization({ current, workspaceRoot: fixture.root }),
    /local mpqHash binding or reassignment/u,
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

async function copiedUnwiredFixture(
  t,
  {
    symbol = 'crc32#0',
    active = 'none',
    surface = 'active',
    contributionPattern = './contributions/*.json',
  } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'algorithm-unwired-test-'))
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir())
    assert.ok(path.basename(root).startsWith('algorithm-unwired-test-'))
    await rm(root, { recursive: true, force: true })
  })
  const packageRoot = 'modkit-extensions-blizzard/starcraft2'
  const destination = `${packageRoot}/src/lib/mk2/staged/hash.ts`
  const text = 'export function crc32() { return 42 }'
  await mkdir(path.dirname(path.join(root, destination)), { recursive: true })
  await mkdir(path.join(root, packageRoot, 'src'), { recursive: true })
  await mkdir(path.join(root, packageRoot, 'contributions'), { recursive: true })
  await writeFile(path.join(root, destination), text)
  const activeText =
    active === 'import'
      ? "import './lib/mk2/staged/hash.js'\nexport const active = true\n"
      : active === 'reexport'
        ? "export { crc32 } from './lib/mk2/staged/hash.js'\n"
        : 'export const active = true\n'
  await writeFile(path.join(root, packageRoot, 'src/active.ts'), activeText)
  await writeFile(path.join(root, packageRoot, 'src/cli.ts'), 'export const cli = true\n')
  await mkdir(path.join(root, packageRoot, 'dist'), { recursive: true })
  await writeFile(path.join(root, packageRoot, 'dist/orphan.js'), 'export const orphan = true\n')
  await writeFile(
    path.join(root, packageRoot, 'src/surface.js'),
    "import './lib/mk2/staged/hash.js'\nexport const surface = true\n",
  )
  await writeFile(
    path.join(root, packageRoot, 'package.json'),
    JSON.stringify({
      exports:
        surface === 'array-staged'
          ? { '.': ['./src/active.js', ['./src/lib/mk2/staged/hash.js']] }
          : {
              '.':
                surface === 'staged'
                  ? './src/lib/mk2/staged/hash.js'
                  : surface === 'js-wrapper'
                    ? './src/surface.js'
                    : surface === 'dist-orphan'
                      ? './dist/orphan.js'
                      : './src/active.js',
            },
      bin: { fixture: './dist/cli.js' },
      modkit: { contributionManifests: [contributionPattern] },
    }),
  )
  await writeFile(
    path.join(root, packageRoot, 'contributions/codec.json'),
    JSON.stringify({ runtimeVariants: [{ entrypoint: './src/active.js' }] }),
  )
  await writeFile(
    path.join(root, packageRoot, 'tsconfig.json'),
    JSON.stringify({ include: ['src/**/*.ts'], exclude: ['src/lib/mk2/**'] }),
  )
  const runtimeSurfaceRoots = await sc2RuntimeSurfaceRoots({ workspaceRoot: root })
  return {
    root,
    destination,
    text,
    options: {
      workspaceRoot: root,
      repositories: ['modkit-extensions-blizzard'],
      productionTsconfig: SC2_ALGORITHM_PRODUCTION_TSCONFIG,
      runtimeSurfaceRoots,
      copiedUnwiredFiles: [
        {
          mk2Path: 'legacy/hash.ts',
          destination,
          sha256Mk3: sha256(text),
          algorithmDisposition: {
            symbol,
            kind: 'copied-unwired-copy',
            reason: 'Exact fixture allowance.',
            exit: 'canonicalize-before-activation',
          },
        },
      ],
    },
  }
}

test('copied-unwired classification is exact and hash-bound', async t => {
  const fixture = await copiedUnwiredFixture(t)
  const scan = await scanAlgorithms(fixture.options)
  const row = scan.implementations.find(item => item.path === fixture.destination)
  assert.equal(row.disposition, 'copied-unwired-copy')
  assert.equal(row.symbol, 'crc32#0')
  assert.deepEqual(
    ratchetAlgorithmSnapshot(scan).implementations.filter(
      item => item.disposition === 'copied-unwired-copy',
    ),
    [],
  )
})

test('an undeclared same-name peer remains new algorithm debt', async t => {
  const fixture = await copiedUnwiredFixture(t)
  const baseline = await scanAlgorithms(fixture.options)
  await writeFile(
    path.join(fixture.root, path.dirname(fixture.destination), 'peer.ts'),
    fixture.text,
  )
  const scan = await scanAlgorithms(fixture.options)
  const peer = scan.implementations.find(item => item.path.endsWith('/peer.ts'))
  assert.equal(peer.disposition, 'existing-debt')
  assert.match(checkAlgorithmDebt(scan, baseline).failures[0], /New undeclared/u)
})

test('a copied-unwired destination hash tamper fails closed', async t => {
  const fixture = await copiedUnwiredFixture(t)
  await writeFile(path.join(fixture.root, fixture.destination), `${fixture.text}\n// tampered`)
  await assert.rejects(() => scanAlgorithms(fixture.options), /copy hash mismatch/u)
})

test('a direct import of excluded copied-unwired code from production fails closed', async t => {
  const fixture = await copiedUnwiredFixture(t, { active: 'import' })
  await assert.rejects(
    () => scanAlgorithms(fixture.options),
    /copied-unwired algorithm became active/u,
  )
})

test('a re-export of excluded copied-unwired code from production fails closed', async t => {
  const fixture = await copiedUnwiredFixture(t, { active: 'reexport' })
  await assert.rejects(
    () => scanAlgorithms(fixture.options),
    /copied-unwired algorithm became active/u,
  )
})

test('a direct SC2 package runtime surface to copied-unwired code fails closed', async t => {
  const fixture = await copiedUnwiredFixture(t, { surface: 'staged' })
  await assert.rejects(
    () => scanAlgorithms(fixture.options),
    /copied-unwired algorithm became active/u,
  )
})

test('an authored JavaScript runtime surface importing copied-unwired code fails closed', async t => {
  const fixture = await copiedUnwiredFixture(t, { surface: 'js-wrapper' })
  await assert.rejects(
    () => scanAlgorithms(fixture.options),
    /copied-unwired algorithm became active/u,
  )
})

test('a nested conditional export array reaching copied-unwired code fails closed', async t => {
  const fixture = await copiedUnwiredFixture(t, { surface: 'array-staged' })
  await assert.rejects(
    () => scanAlgorithms(fixture.options),
    /copied-unwired algorithm became active/u,
  )
})

test('a changed contribution manifest pattern fails closed despite a populated old directory', async t => {
  await assert.rejects(
    () => copiedUnwiredFixture(t, { contributionPattern: './other/*.json' }),
    /Unexpected SC2 contribution manifest inventory pattern/u,
  )
})

test('an orphaned dist JavaScript runtime surface cannot replace authored source', async t => {
  await assert.rejects(
    () => copiedUnwiredFixture(t, { surface: 'dist-orphan' }),
    /Missing SC2 runtime surface source/u,
  )
})

test('an arbitrary alternate production tsconfig cannot be supplied', async t => {
  const fixture = await copiedUnwiredFixture(t)
  await assert.rejects(
    () => scanAlgorithms({ ...fixture.options, productionTsconfig: 'repo/tsconfig.json' }),
    /Trusted SC2 production tsconfig is required/u,
  )
})

test('an unexpected third copied-unwired allowance fails closed', () => {
  const expected = ['repo/a.ts:crc32#0', 'repo/b.ts:parseXml#0']
  const records = expected.map(id => {
    const split = id.lastIndexOf(':')
    return {
      destination: id.slice(0, split),
      algorithmDisposition: { symbol: id.slice(split + 1) },
    }
  })
  assert.deepEqual(validateCopiedUnwiredAllowanceIds(records, expected), records)
  assert.throws(
    () =>
      validateCopiedUnwiredAllowanceIds(
        [
          ...records,
          { destination: 'repo/c.ts', algorithmDisposition: { symbol: 'sha1#0' } },
        ],
        expected,
      ),
    /Unexpected copied-unwired algorithm allowance/u,
  )
})

test('a stale copied-unwired symbol fails closed', async t => {
  const fixture = await copiedUnwiredFixture(t, { symbol: 'crc32#1' })
  await assert.rejects(
    () => scanAlgorithms(fixture.options),
    /Stale copied-unwired algorithm disposition/u,
  )
})
