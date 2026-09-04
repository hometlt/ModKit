import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const evidenceRoot = path.dirname(fileURLToPath(import.meta.url))
const coreRoot = path.resolve(evidenceRoot, '..', '..')
const workspaceRoot = path.dirname(coreRoot)
const blizzardRoot = path.join(workspaceRoot, 'modkit-extensions-blizzard')
const mk2Root = path.join(workspaceRoot, 'references', 'modkitmk2')
const reportPath = path.resolve(evidenceRoot, '..', 'PORT_SC2_FAMILY_M3_2026-09-05.md')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const json = bytes => JSON.parse(bytes.toString('utf8'))
const readEvidence = relative => readFile(path.join(evidenceRoot, ...relative.split('/')))

const walk = async (directory, prefix = '') => {
  const rows = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) rows.push(...(await walk(path.join(directory, entry.name), relative)))
    else if (entry.isFile()) rows.push(relative)
    else throw new Error(`unexpected evidence entry type: ${relative}`)
  }
  return rows.sort()
}

const receipt = json(await readEvidence('receipt.json'))
assert.equal(receipt.schemaVersion, 1)
assert.equal(receipt.milestone, 'M3')
assert.equal(receipt.stage, 'family-copy-ready')
assert.equal(receipt.verdict, 'pass')
assert.equal(receipt.ownerAcceptance, 'pending')
assert.equal(receipt.nextMilestone, 'M4 requires separate owner acceptance of M3')

const manifestBytes = await readEvidence('manifest.json')
assert.equal(sha256(manifestBytes), receipt.evidenceManifest.sha256)
const manifest = json(manifestBytes)
assert.equal(manifest.schemaVersion, 1)
assert.equal(manifest.algorithm, 'sha256')
assert.equal(manifest.files.length, receipt.evidenceManifest.fileCount)
assert.equal(
  manifest.files.reduce((sum, file) => sum + file.bytes, 0),
  receipt.evidenceManifest.totalBytes,
)

const safePath = relative =>
  typeof relative === 'string' &&
  !relative.includes('\\') &&
  !relative.includes(':') &&
  relative.split('/').every(part => part && part !== '.' && part !== '..')
const evidenceManifestPaths = new Set()
for (const file of manifest.files) {
  assert.ok(safePath(file.path), `unsafe evidence path: ${file.path}`)
  assert.ok(!evidenceManifestPaths.has(file.path), `duplicate evidence path: ${file.path}`)
  assert.notEqual(file.path, 'receipt.json')
  assert.notEqual(file.path, 'manifest.json')
  evidenceManifestPaths.add(file.path)
  const bytes = await readEvidence(file.path)
  assert.equal(bytes.length, file.bytes, `evidence byte count: ${file.path}`)
  assert.equal(sha256(bytes), file.sha256, `evidence digest: ${file.path}`)
}
const actualEvidencePaths = (await walk(evidenceRoot)).filter(
  relative => relative !== 'receipt.json' && relative !== 'manifest.json',
)
assert.deepEqual(
  [...evidenceManifestPaths].sort(),
  actualEvidencePaths,
  'evidence manifest completeness',
)
assert.equal(sha256(await readFile(reportPath)), receipt.report.sha256)

const run = (command, args, cwd, options = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, CI: '1', ...options.env },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.error) throw result.error
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  assert.equal(result.status, 0, `${options.name ?? command} failed:\n${output.slice(-4000)}`)
  return output
}
const pnpm = (cwd, args, options = {}) => {
  if (process.platform !== 'win32') return run('pnpm', args, cwd, options)
  const cli = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  return run(process.execPath, [cli, ...args], cwd, options)
}
const git = (cwd, args, encoding = 'utf8') =>
  execFileSync('git', args, {
    cwd,
    encoding,
    windowsHide: true,
    maxBuffer: 512 * 1024 * 1024,
  })

const implementation = json(await readEvidence('repositories/implementation.json'))
const coreCommit = receipt.repositories.core.implementationCommit
const blizzardCommit = receipt.repositories.blizzard.implementationCommit
const oracleCommit = receipt.oracle.commit
assert.equal(coreCommit, '5ea667fe4fc3305283d0e2b3963ffeb7ef842563')
assert.equal(blizzardCommit, '1751abd0d8b54cc03869d996dd2de5550729279d')
assert.equal(oracleCommit, '1a14ba4eddd0ae88de273348ebd44cfb98a0581d')
for (const [cwd, commit] of [
  [coreRoot, coreCommit],
  [blizzardRoot, blizzardCommit],
  [mk2Root, oracleCommit],
]) {
  git(cwd, ['cat-file', '-e', `${commit}^{commit}`])
}

const reportRepositoryPath = 'reports/PORT_SC2_FAMILY_M3_2026-09-05.md'
const evidenceRepositoryPrefix = 'reports/port-sc2-family-m3/'
const isM3EvidencePath = relative =>
  relative === reportRepositoryPath || relative.startsWith(evidenceRepositoryPrefix)
const changedPaths = (cwd, commit) =>
  git(cwd, ['diff', '--name-only', '--no-renames', commit, 'HEAD', '--'])
    .split(/\r?\n/u)
    .filter(Boolean)
const statusRows = cwd =>
  git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']).split(/\r?\n/u).filter(Boolean)
const statusPath = row => {
  assert.ok(!/[RC]/u.test(row.slice(0, 2)), `rename/copy status is not admissible: ${row}`)
  return row.slice(3).replaceAll('\\', '/')
}

git(coreRoot, ['merge-base', '--is-ancestor', coreCommit, 'HEAD'])
assert.ok(changedPaths(coreRoot, coreCommit).every(isM3EvidencePath))
for (const row of statusRows(coreRoot))
  assert.ok(isM3EvidencePath(statusPath(row)), `core execution tree is dirty: ${row}`)

git(blizzardRoot, ['merge-base', '--is-ancestor', blizzardCommit, 'HEAD'])
assert.deepEqual(changedPaths(blizzardRoot, blizzardCommit), [])
assert.deepEqual(statusRows(blizzardRoot), [])

assert.equal(implementation.repositories[0].implementationCommit, coreCommit)
assert.equal(implementation.repositories[1].implementationCommit, blizzardCommit)
assert.equal(implementation.repositories[0].commitPaths, 63)
assert.equal(implementation.repositories[1].commitPaths, 1339)
assert.equal(implementation.repositories[0].outsideAllowlist, 0)
assert.equal(implementation.repositories[1].outsideAllowlist, 0)
assert.equal(implementation.diffChecks.coreImplementation.exitCode, 0)
assert.equal(implementation.diffChecks.blizzardAuthoredConfigProvenance.exitCode, 0)
assert.deepEqual(
  {
    exitCode: implementation.diffChecks.blizzardFullCopiedTreeDiagnostic.exitCode,
    acceptanceGate: implementation.diffChecks.blizzardFullCopiedTreeDiagnostic.acceptanceGate,
    diagnostics: implementation.diffChecks.blizzardFullCopiedTreeDiagnostic.diagnostics,
    files: implementation.diffChecks.blizzardFullCopiedTreeDiagnostic.files,
    outside:
      implementation.diffChecks.blizzardFullCopiedTreeDiagnostic.outsideProvenanceBoundCopiedTrees,
  },
  { exitCode: 2, acceptanceGate: false, diagnostics: 44, files: 44, outside: 0 },
)

const gitShow = (cwd, commit, relative) => git(cwd, ['show', `${commit}:${relative}`], null)
const archivedProvenanceBytes = await readEvidence('inputs/MK2-FAMILY-PROVENANCE.json')
const committedProvenanceBytes = gitShow(
  blizzardRoot,
  blizzardCommit,
  'starcraft2/MK2-FAMILY-PROVENANCE.json',
)
assert.ok(archivedProvenanceBytes.equals(committedProvenanceBytes))
const provenance = json(archivedProvenanceBytes)
assert.equal(provenance.oracleCommit, oracleCommit)
assert.equal(provenance.files.length, 1460)
assert.equal(provenance.closure.length, 4840)
assert.equal(provenance.dependencies.length, 50)
assert.equal(provenance.importDispositions.length, 630)

for (const [evidencePath, cwd, commit, repositoryPath] of [
  ['inputs/sc2-copy.json', coreRoot, coreCommit, 'migration/mk2-copy/sc2.json'],
  ['inputs/sc2-m3-refreeze.json', coreRoot, coreCommit, 'migration/mk2-copy/sc2-m3-refreeze.json'],
  ['inputs/algorithms-baseline.json', coreRoot, coreCommit, 'migration/algorithms-baseline.json'],
  [
    'inputs/vitest-m3-family-libraries.workspace.mjs',
    blizzardRoot,
    blizzardCommit,
    'starcraft2/test/vitest.m3-family-libraries.workspace.mjs',
  ],
  ['inputs/vitest.config.mjs', blizzardRoot, blizzardCommit, 'test/vitest.config.mjs'],
  [
    'inputs/test-tier-routing.test.mjs',
    blizzardRoot,
    blizzardCommit,
    'test/test-tier-routing.test.mjs',
  ],
]) {
  assert.ok((await readEvidence(evidencePath)).equals(gitShow(cwd, commit, repositoryPath)))
}

const batchBlobs = (cwd, specs) => {
  const input = `${specs.map(spec => spec.object).join('\n')}\n`
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd,
    input,
    encoding: null,
    windowsHide: true,
    maxBuffer: 512 * 1024 * 1024,
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr?.toString('utf8'))
  const output = result.stdout
  const blobs = new Map()
  let offset = 0
  for (const spec of specs) {
    const newline = output.indexOf(10, offset)
    assert.notEqual(newline, -1, `missing Git batch header: ${spec.key}`)
    const header = output.subarray(offset, newline).toString('utf8')
    const match = /^([0-9a-f]{40,64}) blob (\d+)$/u.exec(header)
    assert.ok(match, `Git object unavailable for ${spec.key}: ${header}`)
    const size = Number(match[2])
    const start = newline + 1
    const end = start + size
    assert.ok(end < output.length, `truncated Git blob: ${spec.key}`)
    assert.equal(output[end], 10, `missing Git batch separator: ${spec.key}`)
    blobs.set(spec.key, { oid: match[1], bytes: output.subarray(start, end) })
    offset = end + 1
  }
  assert.equal(offset, output.length, 'unexpected trailing Git batch output')
  return blobs
}

const sourceSpecs = provenance.files.map(file => ({
  key: file.mk2Path,
  object: `${oracleCommit}:${file.mk2Path}`,
}))
const coreDestinationFiles = provenance.files.filter(file =>
  file.destination.startsWith('modkit-core/'),
)
const blizzardDestinationFiles = provenance.files.filter(file =>
  file.destination.startsWith('modkit-extensions-blizzard/'),
)
assert.equal(coreDestinationFiles.length, 94)
assert.equal(blizzardDestinationFiles.length, 1366)
const sourceBlobs = batchBlobs(mk2Root, sourceSpecs)
const coreDestinationBlobs = batchBlobs(
  coreRoot,
  coreDestinationFiles.map(file => ({
    key: file.destination,
    object: `${coreCommit}:${file.destination.slice('modkit-core/'.length)}`,
  })),
)
const blizzardDestinationBlobs = batchBlobs(
  blizzardRoot,
  blizzardDestinationFiles.map(file => ({
    key: file.destination,
    object: `${blizzardCommit}:${file.destination.slice('modkit-extensions-blizzard/'.length)}`,
  })),
)
const destinationBlobs = new Map([...coreDestinationBlobs, ...blizzardDestinationBlobs])

const importLiteralOccurrences = (text, filename) => {
  const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true)
  assert.equal(file.parseDiagnostics.length, 0, `${filename}: parse diagnostics`)
  const occurrences = []
  const add = node => {
    assert.ok(node, `${filename}: import argument`)
    occurrences.push({
      index: node.getStart(file),
      literal: ts.isStringLiteralLike(node) ? node.getText(file) : null,
    })
  }
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      add(node.moduleReference.expression)
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      add(node.argument.literal)
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      add(node.arguments[0])
    ts.forEachChild(node, visit)
  }
  visit(file)
  for (const ref of [...file.referencedFiles, ...file.typeReferenceDirectives])
    occurrences.push({ index: ref.pos, literal: text.slice(ref.pos, ref.end) })
  return occurrences
}

const replaceExact = (text, from, to, expectedCount, label, options = {}) => {
  const occurrences =
    options.kind === 'import'
      ? importLiteralOccurrences(text, options.filename).filter(item => item.literal === from)
      : [...text.matchAll(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'))].map(
          match => ({ index: match.index }),
        )
  assert.equal(occurrences.length, expectedCount, `${label}: replacement count`)
  for (const occurrence of occurrences.toReversed())
    text = `${text.slice(0, occurrence.index)}${to}${text.slice(occurrence.index + from.length)}`
  return text
}
const sourcePaths = new Set()
const destinationPaths = new Set()
let testFiles = 0
for (const file of provenance.files) {
  assert.ok(!sourcePaths.has(file.mk2Path), `duplicate MK2 source: ${file.mk2Path}`)
  assert.ok(
    !destinationPaths.has(file.destination),
    `duplicate MK3 destination: ${file.destination}`,
  )
  sourcePaths.add(file.mk2Path)
  destinationPaths.add(file.destination)
  if (file.destination.includes('/test/')) testFiles += 1
  assert.ok(!file.mk2Path.includes('games/heroes-of-the-storm'))

  const source = sourceBlobs.get(file.mk2Path)
  const destination = destinationBlobs.get(file.destination)
  assert.ok(source && destination, `missing blob mapping: ${file.mk2Path}`)
  assert.equal(source.oid, file.gitBlob, `pinned Git blob: ${file.mk2Path}`)
  assert.equal(sha256(source.bytes), file.sha256Mk2, `pinned SHA256: ${file.mk2Path}`)
  assert.equal(sha256(destination.bytes), file.sha256Mk3, `destination SHA256: ${file.destination}`)

  if (!(file.rewrites?.length || file.divergence)) {
    assert.ok(source.bytes.equals(destination.bytes), `unexpected byte change: ${file.destination}`)
    continue
  }
  let transformed = source.bytes.toString('utf8')
  assert.ok(
    Buffer.from(transformed, 'utf8').equals(source.bytes),
    `non-text rewrite: ${file.mk2Path}`,
  )
  for (const [index, rewrite] of (file.rewrites ?? []).entries()) {
    assert.equal(sha256(Buffer.from(transformed)), rewrite.sha256Before)
    transformed = replaceExact(
      transformed,
      rewrite.from,
      rewrite.to,
      rewrite.count,
      `${file.mk2Path} rewrite ${index}`,
      { kind: rewrite.kind, filename: file.mk2Path },
    )
    assert.equal(sha256(Buffer.from(transformed)), rewrite.sha256After)
  }
  for (const [index, edit] of (file.divergence?.edits ?? []).entries()) {
    assert.equal(file.divergence.semantic, false)
    assert.equal(sha256(Buffer.from(transformed)), edit.sha256Before)
    transformed = replaceExact(
      transformed,
      edit.from,
      edit.to,
      edit.count,
      `${file.mk2Path} divergence ${index}`,
    )
    assert.equal(sha256(Buffer.from(transformed)), edit.sha256After)
  }
  assert.ok(
    Buffer.from(transformed).equals(destination.bytes),
    `declared transform: ${file.destination}`,
  )
}
assert.equal(testFiles, 618)
assert.equal(provenance.files.length - testFiles, 842)
assert.equal(provenance.files.filter(file => file.divergence).length, 3)
for (const proof of new Map(
  provenance.files.flatMap(file => file.divergence?.proof ?? []).map(row => [row.path, row]),
).values()) {
  const prefix = proof.path.startsWith('modkit-core/')
    ? 'modkit-core/'
    : proof.path.startsWith('modkit-extensions-blizzard/')
      ? 'modkit-extensions-blizzard/'
      : null
  assert.ok(prefix, `unknown divergence proof owner: ${proof.path}`)
  const bytes = gitShow(
    prefix === 'modkit-core/' ? coreRoot : blizzardRoot,
    prefix === 'modkit-core/' ? coreCommit : blizzardCommit,
    proof.path.slice(prefix.length),
  )
  assert.equal(sha256(bytes), proof.sha256, `divergence proof: ${proof.path}`)
}

const provenanceSummary = json(await readEvidence('inputs/provenance-summary.json'))
assert.deepEqual(
  {
    pin: provenanceSummary.oracleCommit,
    files: provenanceSummary.files,
    source: provenanceSummary.sourceFiles,
    tests: provenanceSummary.testFiles,
    imports: provenanceSummary.imports,
    dependencies: provenanceSummary.dependencies,
    nonBuiltin: provenanceSummary.nonBuiltinDependencyRows,
    manifests: provenanceSummary.uniqueNonBuiltinDependencyManifests,
    dispositions: provenanceSummary.importDispositions,
    hots: provenanceSummary.heroesOfTheStormSources,
    digest: provenanceSummary.provenanceSha256,
  },
  {
    pin: oracleCommit,
    files: 1460,
    source: 842,
    tests: 618,
    imports: 4840,
    dependencies: 50,
    nonBuiltin: 32,
    manifests: 14,
    dispositions: 630,
    hots: 0,
    digest: sha256(archivedProvenanceBytes),
  },
)

const dependencyIndex = json(await readEvidence('inputs/dependencies/index.json'))
assert.equal(dependencyIndex.dependencyRows, 50)
assert.equal(dependencyIndex.nonBuiltinRows, 32)
assert.equal(dependencyIndex.uniqueManifestPaths, 14)
assert.equal(dependencyIndex.dependencies.length, provenance.dependencies.length)
const dependencyManifestPaths = new Set()
for (let index = 0; index < provenance.dependencies.length; index += 1) {
  const declared = provenance.dependencies[index]
  const archived = dependencyIndex.dependencies[index]
  assert.equal(archived.specifier, declared.specifier)
  assert.equal(archived.kind, declared.kind)
  if (declared.kind === 'node-builtin') continue
  assert.equal(archived.package, declared.package)
  assert.equal(archived.manifest, declared.manifest)
  assert.equal(archived.version, declared.version)
  assert.equal(archived.manifestSha256, declared.manifestSha256)
  const manifestBytes = await readEvidence(`inputs/${archived.archivePath}`)
  assert.equal(sha256(manifestBytes), declared.manifestSha256)
  assert.equal(json(manifestBytes).version, declared.version)
  dependencyManifestPaths.add(declared.manifest)
  assert.equal((archived.assets ?? []).length, (declared.assets ?? []).length)
  for (let assetIndex = 0; assetIndex < (declared.assets ?? []).length; assetIndex += 1) {
    const declaredAsset = declared.assets[assetIndex]
    const archivedAsset = archived.assets[assetIndex]
    assert.equal(archivedAsset.path, declaredAsset.path)
    assert.equal(archivedAsset.sha256, declaredAsset.sha256)
    assert.equal(
      sha256(await readEvidence(`inputs/${archivedAsset.archivePath}`)),
      declaredAsset.sha256,
    )
  }
}
assert.equal(dependencyManifestPaths.size, 14)

const parseJsonLog = async relative => json(await readEvidence(relative))
assert.deepEqual(await parseJsonLog('copy/family.log'), {
  scope: 'family',
  files: 1460,
  imports: 4840,
})
assert.deepEqual(await parseJsonLog('copy/m1-libs.log'), {
  scope: 'm1-libs',
  files: 50,
  imports: 97,
})
assert.deepEqual(await parseJsonLog('copy/sc2-bank.log'), {
  scope: 'sc2-bank',
  files: 87,
  imports: 217,
})
assert.deepEqual(await parseJsonLog('migration/algorithms.log'), {
  repositories: 6,
  failures: [],
  debt: 51,
  canonical: 5,
  copiedUnwired: 2,
  new: 0,
  retired: [],
})

for (const [scope, expected] of [
  ['family', { scope: 'family', files: 1460, imports: 4840 }],
  ['m1-libs', { scope: 'm1-libs', files: 50, imports: 97 }],
  ['sc2-bank', { scope: 'sc2-bank', files: 87, imports: 217 }],
]) {
  const output = run(
    process.execPath,
    ['scripts/migration/check-mk2-copy.mjs', '--family', 'sc2', '--scope', scope],
    coreRoot,
    { name: `fresh copy gate ${scope}` },
  )
  assert.deepEqual(JSON.parse(output.trim()), expected)
}
const algorithms = JSON.parse(
  run(process.execPath, ['scripts/migration/check-algorithms.mjs'], coreRoot, {
    name: 'fresh algorithms gate',
  }).trim(),
)
assert.deepEqual(algorithms.failures, [])
assert.deepEqual(
  {
    debt: algorithms.debt,
    canonical: algorithms.canonical,
    copiedUnwired: algorithms.copiedUnwired,
    new: algorithms.new,
  },
  { debt: 51, canonical: 5, copiedUnwired: 2, new: 0 },
)

const archiveSuites = json(await readEvidence('inputs/archive-suites.json'))
const deferred = [
  'index.spec.ts',
  'optional-extension-loaders.spec.ts',
  'source.spec.ts',
  'vfs-browser-boundary.spec.ts',
  'vfs-mount.spec.ts',
]
const expectedArchiveSuites = [
  {
    name: 'cache.spec.ts',
    declarations: 8,
    vitestLeaves: 8,
    status: 'pass',
    milestone: 'M3',
  },
  {
    name: 'index.spec.ts',
    declarations: 27,
    vitestLeaves: 29,
    status: 'deferred-by-plan',
    milestone: 'M4/P11',
  },
  {
    name: 'optional-extension-loaders.spec.ts',
    declarations: 1,
    vitestLeaves: 1,
    status: 'deferred-by-plan',
    milestone: 'M4/P11',
  },
  {
    name: 'source.spec.ts',
    declarations: 2,
    vitestLeaves: 2,
    status: 'deferred-by-plan',
    milestone: 'M4/P11',
  },
  {
    name: 'vfs-browser-boundary.spec.ts',
    declarations: 2,
    vitestLeaves: 2,
    status: 'deferred-by-plan',
    milestone: 'M4/P11',
  },
  {
    name: 'vfs-mount.spec.ts',
    declarations: 9,
    vitestLeaves: 9,
    status: 'deferred-by-plan',
    milestone: 'M4/P11',
  },
]
assert.equal(archiveSuites.totalSuites, 6)
assert.equal(archiveSuites.declarations, 49)
assert.deepEqual(archiveSuites.executableInM3, ['cache.spec.ts'])
assert.deepEqual(archiveSuites.deferredByPlan, deferred)
assert.deepEqual(
  archiveSuites.suites.map(({ name, declarations, vitestLeaves, status, milestone }) => ({
    name,
    declarations,
    vitestLeaves,
    status,
    milestone,
  })),
  expectedArchiveSuites,
)
assert.deepEqual(
  archiveSuites.suites.filter(suite => suite.status === 'pass').map(suite => suite.name),
  archiveSuites.executableInM3,
)
assert.deepEqual(
  archiveSuites.suites
    .filter(suite => suite.status === 'deferred-by-plan')
    .map(suite => suite.name),
  archiveSuites.deferredByPlan,
)
for (const suite of archiveSuites.suites) {
  const record = provenance.files.find(file => file.mk2Path === suite.mk2Path)
  assert.ok(record)
  assert.equal(record.destination, suite.destination)
  assert.equal(record.sha256Mk2, suite.sha256Mk2)
  assert.equal(record.sha256Mk3, suite.sha256Mk3)
}

const listRows = output =>
  output
    .split(/\r?\n/u)
    .map(line => /^\[([^\]]+)\]\s+(.+)$/u.exec(line.trim()))
    .filter(Boolean)
    .map(match => ({ project: match[1], file: match[2].replaceAll('\\', '/') }))
const dedicated = listRows(
  pnpm(blizzardRoot, ['--dir', 'starcraft2', 'test:mk2-libraries:list'], {
    name: 'fresh M3 test collection',
  }),
)
const projectNames = [...new Set(dedicated.map(row => row.project))].sort()
assert.equal(dedicated.length, 76)
assert.equal(new Set(dedicated.map(row => `${row.project}:${row.file}`)).size, 76)
assert.equal(projectNames.length, 12)
assert.deepEqual(
  dedicated
    .filter(row => row.project === 'archives-processing')
    .map(row => path.posix.basename(row.file)),
  ['cache.spec.ts'],
)
assert.equal(
  dedicated.filter(
    row => row.file.includes('/test/mk2/codecs/') || row.file.includes('models/test/mk2/m3/'),
  ).length,
  0,
)
for (const [tier, expected] of [
  ['quick', 31],
  ['owner', 34],
  ['real', 11],
]) {
  const output = pnpm(
    blizzardRoot,
    ['exec', 'vitest', 'list', '--config', './test/vitest.config.mjs', '--filesOnly'],
    { name: `fresh normal ${tier} collection`, env: { MODKIT_TEST_TIER: tier } },
  )
  const files = output
    .split(/\r?\n/u)
    .map(line => line.trim().replaceAll('\\', '/'))
    .filter(Boolean)
  assert.equal(files.length, expected)
  assert.equal(new Set(files).size, expected)
  assert.equal(
    files.filter(file => file.includes('/test/mk2/') || file.startsWith('models/test/mk2/')).length,
    0,
  )
}

const archiveRun = pnpm(
  blizzardRoot,
  [
    'exec',
    'vitest',
    'run',
    '--workspace',
    'starcraft2/test/vitest.m3-family-libraries.workspace.mjs',
    '--project',
    'archives-processing',
  ],
  { name: 'fresh archive cache gate' },
)
assert.match(archiveRun, /Test Files\s+1 passed \(1\)/u)
assert.match(archiveRun, /Tests\s+8 passed \(8\)/u)
assert.match(archiveRun, /\|archives-processing\|.+cache\.spec\.ts \(8 tests\)/u)

pnpm(coreRoot, ['--dir', 'packages/codec-kit', 'typecheck'], { name: 'core codec-kit typecheck' })
pnpm(
  coreRoot,
  ['--dir', 'packages/codec-kit', 'exec', 'tsc', '-p', 'tsconfig.mk2-libraries.json', '--noEmit'],
  { name: 'core M3 library typecheck' },
)
pnpm(
  coreRoot,
  [
    '--dir',
    'packages/codec-kit',
    'exec',
    'tsc',
    '-p',
    'tsconfig.mk2-libraries.test.json',
    '--noEmit',
  ],
  { name: 'core M3 test typecheck' },
)
assert.match(
  pnpm(coreRoot, ['ts-strict:check'], { name: 'core strict gate' }),
  /ts-strict: 8 packages, problems 0/u,
)
pnpm(blizzardRoot, ['--dir', 'starcraft2', 'typecheck:mk2-libraries'], {
  name: 'Blizzard M3 library typecheck',
})
pnpm(blizzardRoot, ['typecheck'], { name: 'Blizzard production typecheck' })
pnpm(
  blizzardRoot,
  ['exec', 'tsc', '--pretty', 'false', '--noEmit', '-p', './models/tsconfig.json'],
  { name: 'Blizzard models production typecheck' },
)

const diagnosticRaw = json(await readEvidence('diagnostic/vitest-m3-run.json'))
const diagnosticSummary = json(await readEvidence('diagnostic/summary.json'))
const expectedDiagnosticTotals = {
  total: 651,
  passed: 615,
  failed: 7,
  conditionalSkipped: 29,
  todo: 0,
}
assert.equal(diagnosticRaw.success, false)
assert.deepEqual(
  {
    total: diagnosticRaw.numTotalTests,
    passed: diagnosticRaw.numPassedTests,
    failed: diagnosticRaw.numFailedTests,
    conditionalSkipped: diagnosticRaw.numPendingTests,
    todo: diagnosticRaw.numTodoTests,
  },
  expectedDiagnosticTotals,
)
assert.equal(diagnosticRaw.testResults.length, 76)
const diagnosticFiles = new Set(
  diagnosticRaw.testResults.map(result => result.name.replaceAll('\\', '/')),
)
assert.equal(diagnosticFiles.size, 76)
assert.deepEqual(diagnosticSummary.tests, expectedDiagnosticTotals)

const diagnosticAssertions = diagnosticRaw.testResults.flatMap(result =>
  result.assertionResults.map(test => ({
    file: path.relative(blizzardRoot, result.name).replaceAll('\\', '/'),
    fullName: test.fullName,
    status: test.status,
    firstFailure: (test.failureMessages[0] ?? '').split(/\r?\n/u)[0],
  })),
)
assert.equal(diagnosticAssertions.length, expectedDiagnosticTotals.total)
assert.ok(diagnosticAssertions.every(test => ['passed', 'failed', 'skipped'].includes(test.status)))
assert.deepEqual(
  {
    total: diagnosticAssertions.length,
    passed: diagnosticAssertions.filter(test => test.status === 'passed').length,
    failed: diagnosticAssertions.filter(test => test.status === 'failed').length,
    conditionalSkipped: diagnosticAssertions.filter(test => test.status === 'skipped').length,
    todo: diagnosticAssertions.filter(test => test.status === 'todo').length,
  },
  expectedDiagnosticTotals,
)

const expectedDiagnosticFailures = [
  {
    file: 'starcraft2/test/mk2/packages/localization-processing/test/semantic-facade.test.ts',
    fullName:
      'localization semantic compatibility facade registers, routes, and summarizes a codec without knowing which game it serves',
    classification: 'registryActivationAtC1',
    firstFailure:
      'localization codec: register and resolve the adapted contribution through the MK3 host',
  },
  {
    file: 'starcraft2/test/mk2/packages/replays-processing/test/browser-safety.test.ts',
    fullName:
      'browser-safe root boundary keeps node APIs and runtime @modkitx/replay imports out of root-reachable source',
    classification: 'replayRelocationTopologyAtReplayC1',
  },
  {
    file: 'starcraft2/test/mk2/packages/replays-processing/test/semantic-facade.test.ts',
    fullName:
      '@modkitx/replays-processing semantic facade registers and summarizes a codec through the root exports, whatever game it serves',
    classification: 'registryActivationAtC1',
    firstFailure:
      'replay codec: register and resolve the adapted contribution through the MK3 host',
  },
  {
    file: 'starcraft2/test/mk2/packages/maps-processing/test/semantic-facade.test.ts',
    fullName:
      '@modkitx/maps-processing semantic facade still registers the existing SC2 codec through legacy root exports',
    classification: 'registryActivationAtC1',
    firstFailure: 'map codec: register and resolve the adapted contribution through the MK3 host',
  },
  {
    file: 'starcraft2/test/mk2/packages/data-processing/test/semantic-facade.test.ts',
    fullName:
      '@modkitx/data-processing semantic facade registers and summarizes whatever data codec a host hands it',
    classification: 'registryActivationAtC1',
    firstFailure: 'data codec: register and resolve the adapted contribution through the MK3 host',
  },
  {
    file: 'starcraft2/test/mk2/packages/documents-processing/test/semantic-facade.test.ts',
    fullName:
      '@modkitx/documents-processing semantic facade registers and summarizes whatever document codec a host hands it',
    classification: 'registryActivationAtC1',
    firstFailure:
      'document codec: register and resolve the adapted contribution through the MK3 host',
  },
  {
    file: 'starcraft2/test/mk2/packages/layouts-processing/test/semantic-facade.test.ts',
    fullName:
      '@modkitx/layouts-processing semantic facade registers, lists, and summarises whatever codec it is handed',
    classification: 'registryActivationAtC1',
    firstFailure:
      'layout codec: register and resolve the adapted contribution through the MK3 host',
  },
]
const sortFailures = rows =>
  [...rows].sort((left, right) =>
    `${left.file}\0${left.fullName}`.localeCompare(`${right.file}\0${right.fullName}`),
  )
const diagnosticFailures = diagnosticAssertions
  .filter(test => test.status === 'failed')
  .map(({ file, fullName, firstFailure }) => ({ file, fullName, firstFailure }))
const summaryFailures = diagnosticSummary.failures.map(failure => ({
  file: path.relative(blizzardRoot, failure.file).replaceAll('\\', '/'),
  fullName: failure.test,
  firstFailure: failure.firstFailure,
}))
assert.deepEqual(sortFailures(summaryFailures), sortFailures(diagnosticFailures))
assert.deepEqual(
  sortFailures(diagnosticFailures.map(({ file, fullName }) => ({ file, fullName }))),
  sortFailures(expectedDiagnosticFailures.map(({ file, fullName }) => ({ file, fullName }))),
)

const observedFailureDisposition = {
  registryActivationAtC1: 0,
  replayRelocationTopologyAtReplayC1: 0,
}
for (const failure of diagnosticFailures) {
  const expected = expectedDiagnosticFailures.find(
    row => row.file === failure.file && row.fullName === failure.fullName,
  )
  assert.ok(expected)
  if (expected.classification === 'registryActivationAtC1')
    assert.equal(failure.firstFailure, expected.firstFailure)
  else
    assert.match(
      failure.firstFailure,
      /^Error: ENOENT: no such file or directory, scandir '.+[\\/]starcraft2[\\/]test[\\/]mk2[\\/]packages[\\/]replays-processing[\\/]src'$/u,
    )
  observedFailureDisposition[expected.classification] += 1
}
assert.deepEqual(observedFailureDisposition, {
  registryActivationAtC1: 6,
  replayRelocationTopologyAtReplayC1: 1,
})
assert.deepEqual(diagnosticSummary.failureDisposition, observedFailureDisposition)
const diagnosticCollection = json(await readEvidence('diagnostic/vitest-m3-collection.json'))
assert.equal(
  diagnosticCollection.length,
  diagnosticSummary.tests.total - diagnosticSummary.tests.conditionalSkipped,
)
const collectedFiles = new Set(diagnosticCollection.map(test => test.file.replaceAll('\\', '/')))
const runnableFiles = new Set(
  diagnosticRaw.testResults
    .filter(result => result.assertionResults.some(test => test.status !== 'skipped'))
    .map(result => result.name.replaceAll('\\', '/')),
)
assert.deepEqual([...collectedFiles].sort(), [...runnableFiles].sort())

const commands = json(await readEvidence('commands.json'))
assert.ok(commands.normative.length > 0)
assert.ok(
  commands.normative.every(
    command => command.exitCode === 0 && evidenceManifestPaths.has(command.log),
  ),
)
const logText = async relative => (await readEvidence(relative)).toString('utf8')
assert.match(await logText('tests/algorithms.log'), /ℹ pass 17/u)
assert.match(await logText('tests/legacy-oracle.log'), /ℹ pass 3/u)
assert.match(await logText('tests/mk2-copy.log'), /ℹ pass 45/u)
assert.match(await logText('tests/migration-infrastructure.log'), /ℹ pass 121/u)
assert.match(await logText('tests/core-quick.log'), /Test Files\s+23 passed \(23\)/u)
assert.match(await logText('tests/core-quick.log'), /Tests\s+386 passed \(386\)/u)
assert.equal((await logText('tests/blizzard-quick.exit.txt')).trim(), '0')
assert.match(
  await logText('tests/blizzard-quick.log'),
  /portable Blizzard bundle is deterministic/u,
)
assert.match(await logText('tests/blizzard-quick.log'), /ℹ pass 2/u)
assert.match(await logText('tests/blizzard-quick.log'), /Test Files\s+31 passed \(31\)/u)
assert.match(await logText('tests/blizzard-quick.log'), /Tests\s+153 passed \| 3 skipped \(156\)/u)

const registryLine =
  'migration:check registry: known debt 38 (must be empty by wave 6), new problems 0, stale baseline entries 0, unavailable checks 1 (must be restored by wave 6)'
assert.equal(receipt.migration.registryLine, registryLine)
assert.match(
  await logText('migration/migration-check.log'),
  new RegExp(registryLine.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
)
assert.match(
  pnpm(coreRoot, ['migration:check'], { name: 'fresh migration check' }),
  new RegExp(registryLine.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
)

console.log(
  'M3 evidence verified: 1460 pinned files (842 source + 618 test), 4840 imports, 50 dependencies, exact 76-file boundary, archive cache 8/8, and all normative gates green. Owner acceptance remains pending; M4 is not authorized.',
)
