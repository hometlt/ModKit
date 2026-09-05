import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, chmod, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  createPinnedSource,
  loadMk2,
  digestManifest,
  createCorpusManifest,
} from '../lib/legacy-oracle.mjs'

test('pinned source can disable all working-tree observation', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mk2-pinned-only-test-'))
  t.after(async () => {
    assert.equal(path.dirname(root), tmpdir())
    assert.ok(path.basename(root).startsWith('mk2-pinned-only-test-'))
    await rm(root, { recursive: true, force: true })
  })
  const repoRoot = path.join(root, 'repo')
  await mkdir(repoRoot)
  const git = (...args) =>
    execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Pinned Source Test')
  git('config', 'user.email', 'pinned-source@test.invalid')
  await writeFile(path.join(repoRoot, 'source.ts'), 'export const pinned = true\n')
  git('add', 'source.ts')
  git('commit', '-qm', 'pinned source')
  const commit = git('rev-parse', 'HEAD')
  await rm(path.join(repoRoot, 'source.ts'))
  await mkdir(path.join(repoRoot, 'source.ts'))

  const observed = await createPinnedSource({ repoRoot, commit })
  await assert.rejects(observed.read('source.ts'), error => error.code !== 'ENOENT')

  const pinnedOnly = await createPinnedSource({ repoRoot, commit, observeWorkingTree: false })
  const record = await pinnedOnly.read('source.ts')
  assert.equal(record.bytes.toString('utf8'), 'export const pinned = true\n')
  assert.equal(record.workingTreeSha256, null)
  assert.equal(record.workingTreeMatchesPin, null)
})

test('external dependency resolution honors an extensionless package main', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mk2-extensionless-main-test-'))
  t.after(async () => {
    assert.equal(path.dirname(root), tmpdir())
    assert.ok(path.basename(root).startsWith('mk2-extensionless-main-test-'))
    await rm(root, { recursive: true, force: true })
  })
  const repoRoot = path.join(root, 'repo')
  const cacheDir = path.join(root, 'cache')
  await mkdir(repoRoot)
  const git = (...args) =>
    execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Extensionless Main Test')
  git('config', 'user.email', 'extensionless-main@test.invalid')
  await writeFile(path.join(repoRoot, 'package.json'), '{"type":"module"}')
  await writeFile(
    path.join(repoRoot, 'entry.ts'),
    'import legacy from "legacy-main"; export const value = legacy.value\n',
  )
  git('add', 'package.json', 'entry.ts')
  git('commit', '-qm', 'pinned fixture')
  const commit = git('rev-parse', 'HEAD')
  await mkdir(path.join(repoRoot, 'node_modules', 'legacy-main', 'lib'), { recursive: true })
  await writeFile(
    path.join(repoRoot, 'node_modules', 'legacy-main', 'package.json'),
    '{"name":"legacy-main","version":"1.0.0","main":"./lib/legacy"}',
  )
  await writeFile(
    path.join(repoRoot, 'node_modules', 'legacy-main', 'lib', 'legacy.js'),
    'module.exports = { value: 42 }\n',
  )

  const loaded = await loadMk2('entry.ts', {
    repoRoot,
    commit,
    cacheDir,
    operation: 'test.extensionless-main',
    corpusManifest: { kind: 'synthetic-extensionless-main' },
  })
  assert.equal(loaded.module.value, 42)
  const dependency = loaded.evidence.dependencies.find(item => item.name === 'legacy-main')
  assert.ok(dependency)
  assert.ok(dependency.files.some(file => file.path === 'lib/legacy.js'))
})

test('workspace dist exports resolve to an owner package source tree and cache concurrently', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mk2-workspace-source-test-'))
  t.after(async () => {
    assert.equal(path.dirname(root), tmpdir())
    assert.ok(path.basename(root).startsWith('mk2-workspace-source-test-'))
    await rm(root, { recursive: true, force: true })
  })
  const repoRoot = path.join(root, 'repo')
  const cacheDir = path.join(root, 'cache')
  await mkdir(path.join(repoRoot, 'packages', 'archives', 'codecs', 'iso', 'src'), {
    recursive: true,
  })
  const git = (...args) =>
    execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Workspace Source Test')
  git('config', 'user.email', 'workspace-source@test.invalid')
  await writeFile(path.join(repoRoot, 'package.json'), '{"type":"module"}')
  await writeFile(
    path.join(repoRoot, 'entry.ts'),
    'export { value } from "@modkitx/archives/iso"\n',
  )
  await writeFile(
    path.join(repoRoot, 'packages', 'archives', 'package.json'),
    JSON.stringify({
      name: '@modkitx/archives',
      exports: { './iso': { import: './dist/codecs/iso/src/index.js' } },
    }),
  )
  await writeFile(
    path.join(repoRoot, 'packages', 'archives', 'codecs', 'iso', 'src', 'index.ts'),
    'export const value = 42\n',
  )
  git('add', '.')
  git('commit', '-qm', 'pinned workspace source fixture')
  const options = {
    repoRoot,
    cacheDir,
    commit: git('rev-parse', 'HEAD'),
    operation: 'test.workspace-source',
    corpusManifest: { kind: 'synthetic-workspace-source' },
  }
  const [first, second] = await Promise.all([
    loadMk2('entry.ts', options),
    loadMk2('entry.ts', options),
  ])
  assert.equal(first.module.value, 42)
  assert.equal(second.module.value, 42)
  assert.equal(first.evidence.cacheKey, second.evidence.cacheKey)
})

test('pinned source, exports, data, dependencies and every cache identity dimension', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mk2-oracle-test-'))
  const repoRoot = path.join(root, 'repo')
  const cacheDir = path.join(root, 'cache')
  await mkdir(repoRoot)
  const git = (...args) =>
    execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Oracle Test')
  git('config', 'user.email', 'oracle@test.invalid')
  git('config', 'core.autocrlf', 'false')
  async function put(file, content) {
    const target = path.join(repoRoot, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  await put('package.json', '{"type":"module"}')
  await put('tsconfig.base.json', '{"compilerOptions":{"strict":true}}')
  await put(
    'packages/fixture/package.json',
    '{"name":"@modkitx/fixture","exports":{".":{"import":"./dist/index.js"},"./core/*.js":{"import":"./dist/core/*.js"}}}',
  )
  await put('packages/fixture/src/index.ts', 'export { value } from "./core/value.js"')
  await put(
    'packages/fixture/src/core/value.ts',
    'enum Mode { Twenty = 20 }; function mark(value: any) { return value }; @mark class Example { constructor(public count: number) {} }; export const value: number = Mode.Twenty + new Example(1).count',
  )
  await put('data.json', '{"answer":21}')
  await put(
    'entry.ts',
    'import {value} from "@modkitx/fixture/core/value.js"; import {dep} from "example-dep"; import {readFileSync} from "node:fs"; export const answer=value+dep; export const data=JSON.parse(readFileSync(new URL("./data.json",import.meta.url),"utf8")); const pkg="example-dep"; export const dynamic=()=>import(pkg);',
  )
  git('add', '.')
  git('commit', '-qm', 'pinned fixture')
  const commit = git('rev-parse', 'HEAD')
  await put(
    'node_modules/example-dep/package.json',
    '{"name":"example-dep","version":"1.0.0","type":"module","exports":"./index.js","dependencies":{"transitive-dep":"1.0.0"}}',
  )
  await put(
    'node_modules/example-dep/index.js',
    'import {extra} from "transitive-dep"; export const dep=20+extra',
  )
  await put(
    'node_modules/transitive-dep/package.json',
    '{"name":"transitive-dep","version":"1.0.0","type":"module","exports":"./index.js"}',
  )
  await put('node_modules/transitive-dep/index.js', 'export const extra=1')
  await put('node_modules/example-dep/decoder.wasm', 'runtime resource 1')
  const source = await createPinnedSource({ repoRoot, commit })
  assert(source.listFiles().includes('entry.ts'))
  assert.equal((await source.read('data.json')).workingTreeMatchesPin, true)
  await put('data.json', '{"answer":0}')
  const dirtySource = await createPinnedSource({ repoRoot, commit })
  const pinnedData = await dirtySource.read('data.json')
  assert.equal(pinnedData.bytes.toString(), '{"answer":21}')
  assert.equal(pinnedData.workingTreeMatchesPin, false)
  await assert.rejects(source.read('../escape'), /Unsafe/u)
  await assert.rejects(source.read('missing.ts'), /Missing/u)
  await assert.rejects(createPinnedSource({ repoRoot, commit: 'HEAD' }), /immutable/u)
  const options = {
    repoRoot,
    commit,
    cacheDir,
    additionalFiles: ['data.json'],
    runtimeDependencies: [{ name: 'example-dep', files: ['decoder.wasm'] }],
    operation: 'test.answer',
    operationOptions: { level: 1 },
    corpusManifest: { files: [{ id: 'sample', sha256: 'a'.repeat(64) }] },
  }
  const first = await loadMk2('entry.ts', options)
  assert.equal(first.module.answer, 42)
  assert.equal((await first.module.dynamic()).dep, 21)
  assert.equal(first.module.data.answer, 21)
  assert.equal(
    first.evidence.sourceFiles.find(file => file.path === 'data.json').workingTreeMatchesPin,
    false,
  )
  const again = await loadMk2('entry.ts', options)
  assert.equal(again.evidence.cacheKey, first.evidence.cacheKey)
  assert.equal(again.evidence.cacheHit, true)
  await put('packages/fixture/src/core/value.ts', 'export const value=9000')
  const stillPinned = await loadMk2('entry.ts', options)
  assert.equal(stillPinned.module.answer, 42)
  assert.equal(stillPinned.evidence.cacheKey, first.evidence.cacheKey)
  for (const delta of [
    { operation: 'other' },
    { operationOptions: { level: 2 } },
    { corpusManifest: { files: [{ id: 'changed' }] } },
  ]) {
    assert.notEqual(
      (await loadMk2('entry.ts', { ...options, ...delta })).evidence.cacheKey,
      first.evidence.cacheKey,
    )
  }
  const extraLoader = path.join(root, 'loader.mjs')
  await writeFile(extraLoader, '// loader v1')
  const loaderOne = await loadMk2('entry.ts', { ...options, loaderFiles: [extraLoader] })
  await writeFile(extraLoader, '// loader v2')
  assert.notEqual(
    (await loadMk2('entry.ts', { ...options, loaderFiles: [extraLoader] })).evidence.cacheKey,
    loaderOne.evidence.cacheKey,
  )
  await put(
    'node_modules/example-dep/index.js',
    'import {extra} from "transitive-dep"; export const dep=21+extra',
  )
  const depChanged = await loadMk2('entry.ts', options)
  assert.notEqual(depChanged.evidence.cacheKey, first.evidence.cacheKey)
  assert.equal(
    depChanged.module.answer,
    43,
    'dependency ESM module cache must not reuse the old bytes',
  )
  assert.equal(
    (await depChanged.module.dynamic()).dep,
    22,
    'declared dynamic imports use the immutable dependency snapshot',
  )
  await put('node_modules/transitive-dep/index.js', 'export const extra=2')
  const transitiveChanged = await loadMk2('entry.ts', options)
  assert.notEqual(transitiveChanged.evidence.cacheKey, depChanged.evidence.cacheKey)
  assert.equal(transitiveChanged.module.answer, 44)
  await put('node_modules/transitive-dep/index.js', 'export const extra=1')
  await put('node_modules/example-dep/decoder.wasm', 'runtime resource 2')
  const wasmChanged = await loadMk2('entry.ts', options)
  assert.notEqual(wasmChanged.evidence.cacheKey, depChanged.evidence.cacheKey)
  git('add', 'packages/fixture/src/core/value.ts', 'data.json')
  git('commit', '-qm', 'different oracle source')
  const differentSource = await loadMk2('entry.ts', {
    ...options,
    commit: git('rev-parse', 'HEAD'),
  })
  assert.notEqual(differentSource.evidence.sourceClosureDigest, first.evidence.sourceClosureDigest)
  assert.equal(differentSource.module.answer, 9022)
  await assert.rejects(
    loadMk2('entry.ts', { ...options, additionalFiles: ['missing.json'] }),
    /Missing/u,
  )
  await assert.rejects(
    loadMk2('entry.ts', { ...options, additionalFiles: [] }),
    /ENOENT/u,
    'an earlier declaration must not make undeclared dynamic data available',
  )
  await assert.rejects(
    loadMk2('entry.ts', {
      ...options,
      runtimeDependencies: [{ name: 'example-dep', files: ['missing.wasm'] }],
    }),
    /Missing required runtime dependency/u,
  )
  await assert.rejects(
    loadMk2('entry.ts', {
      ...options,
      stubs: [{ path: 'entry.ts', kind: 'algorithm', reason: 'invalid', source: '' }],
    }),
    /host-registry/u,
  )
  const bundle = path.join(wasmChanged.evidence.directory, 'oracle.mjs')
  await chmod(bundle, 0o666)
  await writeFile(bundle, 'export const answer = 0')
  await assert.rejects(loadMk2('entry.ts', options), /Corrupt oracle cache/u)
  const corpusFile = path.join(root, 'sample.bin')
  await writeFile(corpusFile, 'a')
  const corpusA = await createCorpusManifest([corpusFile])
  await writeFile(corpusFile, 'b')
  const corpusB = await createCorpusManifest([corpusFile])
  assert.notEqual(digestManifest(corpusA), digestManifest(corpusB))
  await assert.rejects(createCorpusManifest([]), /empty/u)
  assert.equal(
    await readFile(path.join(repoRoot, 'packages/fixture/src/core/value.ts'), 'utf8'),
    'export const value=9000',
    'oracle never repairs the working tree',
  )
})

test('external snapshots retain required peers, optional installed peers and package self-resolution', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mk2-oracle-peers-'))
  const repoRoot = path.join(root, 'repo')
  const cacheDir = path.join(root, 'cache')
  await mkdir(repoRoot)
  const git = (...args) =>
    execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  async function put(file, content) {
    const target = path.join(repoRoot, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, typeof content === 'string' ? content : JSON.stringify(content))
  }
  git('init', '-q')
  git('config', 'user.name', 'Oracle Test')
  git('config', 'user.email', 'oracle@test.invalid')
  git('config', 'core.autocrlf', 'false')
  await put('package.json', { type: 'module' })
  await put('entry.ts', 'export { answer } from "example-formatter"')
  git('add', '.')
  git('commit', '-qm', 'pinned peer fixture')
  const options = { repoRoot, cacheDir, commit: git('rev-parse', 'HEAD') }
  const formatterManifest = {
    name: 'example-formatter',
    version: '1.0.0',
    type: 'module',
    exports: { '.': './dist/index.js', './self': './dist/self.js' },
    imports: { '#local': './dist/local.js' },
    peerDependencies: { 'example-peer': '^1.0.0', 'optional-peer': '^1.0.0' },
    peerDependenciesMeta: { 'optional-peer': { optional: true } },
  }
  await put('node_modules/example-formatter/package.json', formatterManifest)
  await put(
    'node_modules/example-formatter/dist/index.js',
    'import {value} from "example-peer"; import {self} from "example-formatter/self"; import {local} from "#local"; export const answer=value+self+local',
  )
  await put('node_modules/example-formatter/dist/self.js', 'export const self=10')
  await put('node_modules/example-formatter/dist/local.js', 'export const local=2')
  await put('node_modules/example-peer/package.json', {
    name: 'example-peer',
    version: '1.0.0',
    type: 'module',
    exports: './index.js',
  })
  await put('node_modules/example-peer/index.js', 'export const value=30')
  const first = await loadMk2('entry.ts', options)
  assert.equal(first.module.answer, 42)
  const peer = first.evidence.dependencies.find(item => item.name === 'example-peer')
  const formatter = first.evidence.dependencies.find(item => item.name === 'example-formatter')
  assert.equal(peer.version, '1.0.0')
  assert.equal(formatter.dependencies['example-peer'], peer.root)
  assert.equal(formatter.dependencies['optional-peer'], undefined)
  assert.equal(peer.root, await realpath(path.join(repoRoot, 'node_modules/example-peer')))
  assert.ok(peer.files.some(file => file.path === 'index.js'))
  assert.equal((await loadMk2('entry.ts', options)).evidence.cacheHit, true)

  await put('node_modules/example-peer/index.js', 'export const value=31')
  const changed = await loadMk2('entry.ts', options)
  assert.equal(changed.module.answer, 43)
  assert.equal(changed.evidence.sourceClosureDigest, first.evidence.sourceClosureDigest)
  assert.notEqual(changed.evidence.dependenciesDigest, first.evidence.dependenciesDigest)
  assert.notEqual(changed.evidence.cacheKey, first.evidence.cacheKey)
  assert.equal(first.module.answer, 42, 'loaded snapshots retain their original peer bytes')

  await put('node_modules/optional-peer/package.json', {
    name: 'optional-peer',
    version: '1.0.0',
    type: 'module',
    exports: './index.js',
  })
  await put('node_modules/optional-peer/index.js', 'export const present=true')
  const withOptional = await loadMk2('entry.ts', options)
  const optional = withOptional.evidence.dependencies.find(item => item.name === 'optional-peer')
  assert.ok(optional)
  assert.equal(
    withOptional.evidence.dependencies.find(item => item.name === 'example-formatter').dependencies[
      'optional-peer'
    ],
    optional.root,
  )
  assert.notEqual(withOptional.evidence.cacheKey, changed.evidence.cacheKey)

  await put('node_modules/example-formatter/package.json', {
    ...formatterManifest,
    peerDependencies: { ...formatterManifest.peerDependencies, 'required-missing-peer': '^1.0.0' },
  })
  await assert.rejects(loadMk2('entry.ts', options), /required-missing-peer/u)
})
