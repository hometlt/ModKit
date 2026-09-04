import path from 'node:path'
import { readFile, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createPinnedSource, MK2_PIN, digestManifest, sha256 } from './legacy-oracle.mjs'

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
const enginePath = fileURLToPath(new URL('./legacy-oracle.mjs', import.meta.url))
const hex = /^[a-f0-9]{64}$/u
const samePath = (left, right) =>
  process.platform === 'win32'
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right)

function relative(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    value.includes(':') ||
    path.isAbsolute(value) ||
    value.split('/').some(part => !part || part === '.' || part === '..')
  )
    throw new Error(`Unsafe oracle artifact path: ${value}`)
  return value
}

function identity(evidence) {
  if (identityKeys.some(key => evidence[key] === undefined))
    throw new Error('Incomplete prepared oracle cache identity')
  return Object.fromEntries(identityKeys.map(key => [key, evidence[key]]))
}

async function verifiedBytes(file, expected, label) {
  if (!hex.test(expected ?? '')) throw new Error(`Invalid ${label} SHA256`)
  const bytes = await readFile(file)
  if (sha256(bytes) !== expected) throw new Error(`${label} bytes differ: ${file}`)
  return bytes
}

function unique(rows, key, label) {
  if (!Array.isArray(rows) || !rows.length) throw new Error(`Empty prepared oracle ${label}`)
  const values = rows.map(row => row[key])
  if (
    values.some(value => typeof value !== 'string' || !value) ||
    new Set(values).size !== values.length
  )
    throw new Error(`Invalid/duplicate prepared oracle ${label}`)
}

/**
 * Bind prepared metadata to real loadMk2 cache artifacts and pinned inputs.
 * This does not prove that an arbitrary adapter invokes the verified module honestly:
 * the adapter's semantics still require review. No unverified bundle is imported here.
 */
export async function verifyPreparedOracle(evidence, { corpus, adapterPath, operation, repoRoot }) {
  if (!corpus || (!corpus.cases?.length && !corpus.files?.length))
    throw new Error('Prepared oracle requires a nonempty executed corpus')
  if (typeof operation !== 'string' || !operation)
    throw new Error('Prepared oracle requires an operation')
  if (!adapterPath || !repoRoot)
    throw new Error('Prepared oracle requires adapterPath and repoRoot')
  const modules = evidence?.modules ?? (evidence ? [evidence] : [])
  if (!Array.isArray(modules) || !modules.length)
    throw new Error('Prepared oracle requires nonempty module evidence')
  const adapter = await realpath(adapterPath)
  const adapterSha256 = sha256(await readFile(adapter))
  const source = await createPinnedSource({ repoRoot, commit: MK2_PIN })
  const results = []
  const keys = new Set()
  for (const module of modules) {
    if (!module || module.oracleCommit !== MK2_PIN || module.schemaVersion !== 1)
      throw new Error('Prepared oracle must use the immutable MK2 pin')
    if (module.operation !== operation)
      throw new Error('Prepared oracle operation differs from executed operation')
    if (
      !hex.test(module.cacheKey ?? '') ||
      !hex.test(module.bundleSha256 ?? '') ||
      typeof module.directory !== 'string' ||
      !path.isAbsolute(module.directory)
    )
      throw new Error('Incomplete prepared oracle artifact metadata')
    if (keys.has(module.cacheKey))
      throw new Error('Duplicate prepared oracle module cache identity')
    keys.add(module.cacheKey)
    if (path.basename(module.directory) !== module.cacheKey)
      throw new Error('Prepared oracle directory does not bind its cache identity')
    const manifest = JSON.parse(
      await readFile(path.join(module.directory, 'manifest.json'), 'utf8'),
    )
    const claimedIdentity = identity(module)
    if (
      digestManifest(claimedIdentity) !== module.cacheKey ||
      digestManifest(identity(manifest)) !== module.cacheKey ||
      manifest.cacheKey !== module.cacheKey ||
      manifest.bundleSha256 !== module.bundleSha256 ||
      !samePath(manifest.directory, module.directory)
    )
      throw new Error('Prepared oracle manifest/cache identity mismatch')
    for (const [field, value] of [
      ['sourceClosureDigest', module.source],
      ['loaderDigest', module.loader],
      ['dependenciesDigest', module.dependencies],
      ['corpusDigest', corpus],
    ]) {
      if (module[field] !== digestManifest(value) || manifest[field] !== module[field])
        throw new Error(`Prepared oracle ${field} mismatch`)
    }
    if (digestManifest(module.corpusManifest) !== digestManifest(corpus))
      throw new Error('Prepared oracle corpus differs from executed corpus')
    if (
      module.runtime.node !== process.version ||
      module.runtime.platform !== process.platform ||
      module.runtime.arch !== process.arch
    )
      throw new Error('Prepared oracle runtime differs from current execution')
    if (
      module.build.format !== 'esm' ||
      module.build.target !== 'es2022' ||
      module.build.experimentalDecorators !== true
    )
      throw new Error('Prepared oracle build profile differs from loadMk2')
    await verifiedBytes(
      path.join(module.directory, 'oracle.mjs'),
      module.bundleSha256,
      'Oracle bundle',
    )
    unique(module.source, 'path', 'source closure')
    unique(module.sourceFiles, 'path', 'source records')
    const projection = records =>
      records.map(record => ({ path: record.path, sha256: record.sha256, gitBlob: record.gitBlob }))
    if (
      digestManifest(projection(module.sourceFiles)) !== digestManifest(module.source) ||
      digestManifest(projection(manifest.sourceFiles)) !== digestManifest(module.source)
    )
      throw new Error('Prepared oracle source records differ from cache identity')
    const sourceNames = new Set(module.source.map(record => relative(record.path)))
    if (
      !sourceNames.has(module.entry) ||
      module.additionalFiles.some(file => !sourceNames.has(file))
    )
      throw new Error('Prepared oracle source closure omits entry/additional files')
    for (const record of module.source) {
      const pinned = await source.read(record.path)
      if (pinned.sha256 !== record.sha256 || pinned.gitBlob !== record.gitBlob)
        throw new Error(`Prepared oracle source differs from pinned Git blob: ${record.path}`)
      await verifiedBytes(
        path.join(module.directory, 'source', record.path),
        record.sha256,
        'Oracle source snapshot',
      )
    }
    unique(module.loader, 'path', 'loader closure')
    if (
      !Array.isArray(module.loaderSnapshots) ||
      module.loaderSnapshots.length !== module.loader.length ||
      digestManifest(module.loaderSnapshots) !== digestManifest(manifest.loaderSnapshots)
    )
      throw new Error('Prepared oracle loader snapshots differ')
    let boundAdapter = false
    let boundEngine = false
    for (let index = 0; index < module.loader.length; index++) {
      const record = module.loader[index]
      if (!path.isAbsolute(record.path))
        throw new Error('Prepared oracle loader paths must be absolute')
      await verifiedBytes(record.path, record.sha256, 'Oracle loader/adapter')
      const current = await realpath(record.path)
      if (samePath(current, adapter) && record.sha256 === adapterSha256) boundAdapter = true
      if (samePath(current, await realpath(enginePath))) boundEngine = true
      const snapshot = module.loaderSnapshots[index]
      const expected = path.join(
        module.directory,
        'loader',
        `${index}-${path.basename(record.path)}`,
      )
      if (
        !samePath(snapshot.path, record.path) ||
        snapshot.sha256 !== record.sha256 ||
        !samePath(snapshot.snapshot, expected)
      )
        throw new Error('Prepared oracle loader snapshot identity differs')
      await verifiedBytes(expected, record.sha256, 'Oracle loader snapshot')
    }
    if (!boundAdapter || !boundEngine)
      throw new Error(
        'Prepared oracle loader closure must bind the actual adapter and loadMk2 engine',
      )
    unique(module.dependencies, 'root', 'dependency closure')
    const dependencyRoots = new Map(module.dependencies.map(record => [record.root, record]))
    const dependencyDirectory = path.join(
      path.dirname(module.directory),
      'dependencies',
      module.dependenciesDigest,
    )
    const snapshotRoot = root => path.join(dependencyDirectory, sha256(root))
    for (const dependency of module.dependencies) {
      if (!path.isAbsolute(dependency.root))
        throw new Error('Prepared oracle dependency roots must be absolute')
      unique(dependency.files, 'path', 'dependency files')
      for (const record of dependency.files) {
        const file = relative(record.path)
        await verifiedBytes(path.join(dependency.root, file), record.sha256, 'Oracle dependency')
        await verifiedBytes(
          path.join(snapshotRoot(dependency.root), file),
          record.sha256,
          'Oracle dependency snapshot',
        )
      }
      const packageJson = JSON.parse(
        await readFile(path.join(snapshotRoot(dependency.root), 'package.json'), 'utf8'),
      )
      if (packageJson.name !== dependency.name || packageJson.version !== dependency.version)
        throw new Error('Prepared oracle dependency package identity mismatch')
      for (const [name, root] of Object.entries(dependency.dependencies)) {
        relative(name)
        if (
          !dependencyRoots.has(root) ||
          !samePath(
            await realpath(path.join(snapshotRoot(dependency.root), 'node_modules', name)),
            await realpath(snapshotRoot(root)),
          )
        )
          throw new Error('Prepared oracle transitive dependency link differs')
      }
    }
    const esbuild = module.dependencies.find(record => record.name === 'esbuild')
    const platformPackage = module.dependencies.find(
      record => record.name === `@esbuild/${process.platform}-${process.arch}`,
    )
    if (!esbuild || esbuild.version !== module.runtime.esbuild || !platformPackage)
      throw new Error('Prepared oracle lacks its esbuild runtime identity')
    await verifiedBytes(
      path.join(
        snapshotRoot(platformPackage.root),
        process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild',
      ),
      module.runtime.binaryDigest,
      'Oracle esbuild binary',
    )
    for (const declared of module.runtimeDependencies) {
      const dependency = module.dependencies.find(record => record.name === declared.name)
      if (
        !dependency ||
        (declared.files ?? []).some(file => !dependency.files.some(record => record.path === file))
      )
        throw new Error('Prepared oracle omits declared runtime dependency inputs')
      if (
        !samePath(
          await realpath(path.join(module.directory, 'node_modules', relative(declared.name))),
          await realpath(snapshotRoot(dependency.root)),
        )
      )
        throw new Error('Prepared oracle runtime dependency link differs')
    }
    results.push({
      cacheKey: module.cacheKey,
      directory: module.directory,
      bundleSha256: module.bundleSha256,
      sourceFiles: module.source.length,
      dependencyPackages: module.dependencies.length,
    })
  }
  return {
    verified: true,
    operation,
    corpusDigest: digestManifest(corpus),
    adapterPath: adapter,
    adapterSha256,
    modules: results,
    adapterReviewRequired: true,
  }
}
