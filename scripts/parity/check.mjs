import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import {
  buildInventory,
  artifactNamespaceSourceFromVfsMount,
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  createSubjectServices,
  openSubject,
  registerServiceDefinitionsOrThrow,
} from '@modkitx-x3/host'
import { createModkit } from '@modkitx-x3/host/node'
import { createPathSubjectOpener, loadExtensionDirectory } from '@modkitx-x3/host/node'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import { createRapidVfsProvider } from '@modkitx-x3/vfs/providers/rapid'
import { format as formatWithPrettier } from 'prettier'
import { classifyFormatParity, comparableMetadataFeatures } from './classify.mjs'
import { observeDataSource } from './observe.mjs'
import { blockingParityResults, buildParityReport, gitSha } from './report.mjs'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const canonicalRoot = resolve(
  process.env.MODKIT_PARITY_CANON_ROOT ?? join(repoRoot, '..', 'modkitx'),
)
const mk2Root = resolve(process.env.MODKITX_MK2_ROOT ?? join(repoRoot, '..', 'modkitx'))
const corpusPath = resolve(
  process.env.MODKIT_PARITY_CORPUS ?? join(import.meta.dirname, 'corpus.json'),
)
const outputPath = resolve(
  process.env.MODKIT_PARITY_REPORT ?? join(repoRoot, 'reports', 'parity', 'latest.json'),
)
/**
 * Corpus variables that were renamed, and the name they used to have.
 *
 * `MODKITX_CNC3_ROOT` named the *engine*, and the corpus behind it is one dialect of that engine —
 * Kane's Wrath, not vanilla Tiberium Wars. The two need separate roots, so the precise name won and
 * the old one stays readable rather than breaking every machine that already has it set.
 *
 * The alias is consulted only when the precise name is unset, and saying so out loud is the point:
 * a silent fallback would let a machine keep running on the deprecated name forever.
 */
const DEPRECATED_CORPUS_ALIASES = Object.freeze({
  MODKITX_CNC3_KW_ROOT: 'MODKITX_CNC3_ROOT',
})

const warnedAliases = new Set()

/** Read a corpus variable, falling back to its deprecated alias with one warning per name. */
function readCorpusVariable(name) {
  const direct = process.env[name]
  if (direct !== undefined && direct.trim() !== '') return direct
  const alias = DEPRECATED_CORPUS_ALIASES[name]
  if (alias === undefined) return direct
  const value = process.env[alias]
  if (value === undefined || value.trim() === '') return direct
  if (!warnedAliases.has(alias)) {
    warnedAliases.add(alias)
    console.warn(`parity: deprecated alias ${alias} used for ${name}; set ${name} instead`)
  }
  return value
}

/** Probing the canonical oracle costs a child process per row; the corpus is now large. */
const CONCURRENCY = Number.parseInt(process.env.MODKIT_PARITY_CONCURRENCY ?? '4', 10)

/** Descriptor metadata group every migrated codec publishes its `ProjectionReceipt` under. */
const PROJECTION_RECEIPT_GROUP = 'uv-projection-receipt'
/** Recursive discovery must stay bounded so a mistyped root cannot walk an entire drive. */
const DISCOVERY_NODE_BUDGET = 100_000
const NAMESPACE_PAGE_LIMIT = 256
const CONTAINER_TARGET = Object.freeze({
  environment: 'node',
  operatingSystem: process.platform === 'win32' ? 'windows' : 'linux',
  architecture: process.arch === 'arm64' ? 'arm64' : 'x64',
})
const CONTAINER_GRANT = Object.freeze({ id: 'parity-container', classes: ['read-source'] })
const CONTAINER_BUDGET = Object.freeze({
  maxInputBytes: 1_073_741_824n,
  maxDepth: 128,
  maxNodes: 1_000_000,
  maxScalarBytes: 256 * 1024 * 1024,
  maxDiagnostics: 200,
})
const CONTAINER_EXECUTION_BACKENDS = createExecutionBackendRegistry([
  {
    profile: 'trusted-in-process',
    supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
    async activate(context) {
      return {
        module: await import(context.entrypoint.href),
        release: async () => undefined,
      }
    },
  },
])

async function exists(path) {
  return (await stat(path).catch(() => undefined))?.isFile() === true
}

async function isOpenablePath(path) {
  const entry = await stat(path).catch(() => undefined)
  return entry?.isFile() === true || entry?.isDirectory() === true
}

function pad4(bytes, fill = 0) {
  const length = Math.ceil(bytes.length / 4) * 4
  if (length === bytes.length) return bytes
  const padded = Buffer.alloc(length, fill)
  bytes.copy(padded)
  return padded
}

async function makeGlb(sourcePath, targetPath) {
  const document = JSON.parse(await readFile(sourcePath, 'utf8'))
  const uri = document.buffers?.[0]?.uri
  if (typeof uri !== 'string' || !uri.startsWith('data:') || !uri.includes(';base64,')) {
    throw new TypeError('generated GLB fixture requires one base64 data buffer')
  }
  const binary = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64')
  document.buffers = [{ byteLength: binary.length }]
  const json = pad4(Buffer.from(JSON.stringify(document), 'utf8'), 0x20)
  const bin = pad4(binary)
  const output = Buffer.alloc(12 + 8 + json.length + 8 + bin.length)
  output.writeUInt32LE(0x46546c67, 0)
  output.writeUInt32LE(2, 4)
  output.writeUInt32LE(output.length, 8)
  output.writeUInt32LE(json.length, 12)
  output.writeUInt32LE(0x4e4f534a, 16)
  json.copy(output, 20)
  const binHeader = 20 + json.length
  output.writeUInt32LE(bin.length, binHeader)
  output.writeUInt32LE(0x004e4942, binHeader + 4)
  bin.copy(output, binHeader + 8)
  await writeFile(targetPath, output)
}

/**
 * External corpora never contribute an absolute local path to the tracked report. A sample the
 * environment names directly is published as the tail of its own path, which identifies the file
 * inside the corpus without revealing where the corpus is installed.
 */
function publishedSuffix(path, segments = 3) {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean)
  return parts.length <= segments ? parts.join('/') : `…/${parts.slice(-segments).join('/')}`
}

function skipped(detail) {
  return { state: 'skipped', detail }
}

/**
 * A configured environment variable that does not name the declared sample is a corpus defect, not
 * an absent corpus: §2.2 of the Block 9 execution plan forbids masking it with a skip.
 */
function corpusFailure(detail) {
  return { state: 'failed', detail }
}

function discoverRelative(root, wantedExtension) {
  const pending = ['']
  let visited = 0
  while (pending.length > 0) {
    const folder = pending.shift()
    if (folder === undefined) break
    let entries
    try {
      entries = readdirSync(join(root, folder), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries.toSorted((left, right) =>
      left.name.localeCompare(right.name, 'en'),
    )) {
      visited += 1
      if (visited > DISCOVERY_NODE_BUDGET) {
        throw new RangeError(`corpus discovery under ${root} exceeds the node budget`)
      }
      const child = folder === '' ? entry.name : `${folder}/${entry.name}`
      if (entry.isDirectory()) pending.push(child)
      else if (entry.isFile() && extname(entry.name).toLocaleLowerCase() === wantedExtension)
        return child
    }
  }
  return undefined
}

async function listNamespace(source) {
  const entries = []
  let cursor
  do {
    const page = await source.list('', {
      limit: NAMESPACE_PAGE_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    })
    entries.push(...page.items)
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return entries
}

/**
 * Resolves a model that only exists inside a shipped namespace by walking the real BIG, ZIP or
 * CASC subject with its X3 codec and invoking the subject's own extraction operation. The oracle reads the
 * very same bytes from a scratch file, so both sides compare one archived asset rather than two
 * differently obtained copies.
 */
async function extractContainerEntry(sample, temporaryRoot, archivePath) {
  const containerExtensions = sample.container.x3Extensions ?? [sample.container.x3Extension]
  const inputs = await Promise.all(
    containerExtensions.map(async extension => ({
      ...(await loadExtensionDirectory(resolve(repoRoot, extension))),
      execution: { origin: 'bundled', allowTrustedInProcess: true },
    })),
  )
  const inventory = await buildInventory(inputs, createHostContributionContractRegistry())
  const serviceDefinitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(inventory, serviceDefinitions)
  const subjects = createSubjectServices({
    inventory,
    target: CONTAINER_TARGET,
    executionBackends: CONTAINER_EXECUTION_BACKENDS,
    serviceDefinitions,
  })
  const archiveStat = await stat(archivePath)
  let session
  if (archiveStat.isDirectory()) {
    const mount = await new VirtualFileSystem()
      .registerProvider(createFileVfsProvider())
      .openMount(pathToFileURL(archivePath).href)
    const opened = await openSubject({
      inventory,
      source: artifactNamespaceSourceFromVfsMount(mount),
      path: archivePath,
      intent: 'full',
      target: CONTAINER_TARGET,
      grant: CONTAINER_GRANT,
      budget: CONTAINER_BUDGET,
      executionBackends: CONTAINER_EXECUTION_BACKENDS,
      serviceDefinitions,
    })
    if (opened.state === 'opened') session = opened.session
  } else {
    const open = createPathSubjectOpener({
      subjects,
      roots: [dirname(archivePath), temporaryRoot],
      budget: CONTAINER_BUDGET,
      grant: CONTAINER_GRANT,
    })
    const opened = await open(archivePath)
    if (opened.snapshot.state === 'opened') session = opened.session
  }
  if (session === undefined) {
    return corpusFailure(`${sample.environment} container did not open: ${archivePath}`)
  }
  try {
    const lease = await session.dataSource('common.view/namespace-entry-source', 1)
    try {
      const wanted = sample.container.entry.toLocaleLowerCase()
      const entry = (await listNamespace(lease.value)).find(
        item => item.path.replaceAll('\\', '/').toLocaleLowerCase() === wanted,
      )
      if (entry === undefined) {
        return corpusFailure(
          `${sample.environment} container ${sample.container.relativePath} has no entry ${sample.container.entry}`,
        )
      }
      const extracted = await session.operations().invoke('extract-entry', { entryId: entry.id })
      if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
        return corpusFailure(
          `${sample.environment} container entry ${sample.container.entry} did not extract`,
        )
      }
      const leaf = sample.container.entry.split('/').at(-1) ?? 'entry.bin'
      const path = join(temporaryRoot, `${sample.format}-${leaf}`)
      await writeFile(path, extracted.output.value)
      return { state: 'ready', path }
    } finally {
      await lease.release()
    }
  } finally {
    await session.dispose()
  }
}

/**
 * Resolves a BAR rapid-pool entry through the same bounded public VFS provider used by hosts and
 * codecs. Pinned identity fields turn a wrong package or stale launcher cache into a corpus failure
 * rather than a convenient skip; parity owns only the temporary file required by the sealed probe.
 */
async function extractRapidEntry(sample, temporaryRoot, root) {
  const manifestPath = resolve(root, sample.rapid.manifestRelativePath)
  if (!(await exists(manifestPath))) {
    return corpusFailure(
      `${sample.environment} does not contain ${sample.rapid.manifestRelativePath}`,
    )
  }
  const vfs = new VirtualFileSystem().registerProvider(createRapidVfsProvider())
  let mount
  let source
  try {
    mount = await vfs.openMount(`rapid+${pathToFileURL(manifestPath).href}`)
    const node = await mount.stat(sample.rapid.entry)
    if (node?.kind !== 'file') {
      return corpusFailure(
        `${sample.environment} rapid manifest has no entry ${sample.rapid.entry}`,
      )
    }
    if (
      node.size !== BigInt(sample.rapid.size) ||
      node.revision !== `content-hash.md5:${sample.rapid.md5}`
    ) {
      return corpusFailure(
        `${sample.environment} rapid entry identity differs for ${sample.rapid.entry}`,
      )
    }
    source = await mount.open(node.path)
    const size = await source.size()
    const bytes = await source.readAt(0, size)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== sample.rapid.sha256) {
      return corpusFailure(
        `${sample.environment} rapid pool digest differs for ${sample.rapid.entry}`,
      )
    }
    const leaf = sample.rapid.entry.split('/').at(-1) ?? 'entry.bin'
    const path = join(temporaryRoot, `${sample.format}-${leaf}`)
    await writeFile(path, bytes)
    return {
      state: 'ready',
      path,
      publishedPath: `${sample.rapid.manifestRelativePath}!${sample.rapid.entry}`,
    }
  } catch (error) {
    return corpusFailure(
      `${sample.environment} rapid entry could not be resolved by the public VFS: ${String(error)}`,
    )
  } finally {
    await source?.dispose()
    await mount?.dispose()
    await vfs.dispose()
  }
}

async function locateSample(sample, temporaryRoot) {
  if (typeof sample.generatedFrom === 'string') {
    const source = resolve(repoRoot, sample.generatedFrom)
    const path = join(temporaryRoot, `${sample.format}.glb`)
    await makeGlb(source, path)
    return { state: 'ready', path, publishedPath: `generated from ${sample.generatedFrom}` }
  }
  if (typeof sample.mk2Relative === 'string') {
    const path = resolve(mk2Root, sample.mk2Relative)
    if (!(await stat(mk2Root).catch(() => undefined))?.isDirectory()) {
      return skipped(`MODKITX_MK2_ROOT does not name a checkout`)
    }
    return (await exists(path))
      ? { state: 'ready', path, publishedPath: sample.mk2Relative }
      : corpusFailure(`MODKITX_MK2_ROOT does not contain ${sample.mk2Relative}`)
  }
  if (typeof sample.environment === 'string') {
    const value = readCorpusVariable(sample.environment)
    if (value === undefined || value.trim() === '') {
      return skipped(`${sample.environment} is not set`)
    }
    const root = resolve(value.trim())
    if (sample.rapid !== undefined) {
      return extractRapidEntry(sample, temporaryRoot, root)
    }
    if (sample.container !== undefined) {
      const archivePath = resolve(root, sample.container.relativePath)
      if (!(await isOpenablePath(archivePath))) {
        return corpusFailure(
          `${sample.environment} does not contain ${sample.container.relativePath}`,
        )
      }
      const extracted = await extractContainerEntry(sample, temporaryRoot, archivePath)
      return extracted.state === 'ready'
        ? {
            ...extracted,
            publishedPath: `${sample.container.relativePath}!${sample.container.entry}`,
          }
        : extracted
    }
    if (sample.discover !== undefined) {
      const relative = discoverRelative(root, sample.discover.extension)
      if (relative === undefined) {
        return corpusFailure(
          `${sample.environment} contains no ${sample.discover.extension} sample`,
        )
      }
      return { state: 'ready', path: resolve(root, relative), publishedPath: relative }
    }
    const path = resolve(root, sample.relativePath ?? '')
    if (!(await exists(path))) {
      return corpusFailure(
        `${sample.environment} does not name a file${sample.relativePath === undefined ? '' : `: ${sample.relativePath}`}`,
      )
    }
    return {
      state: 'ready',
      path,
      publishedPath: sample.relativePath ?? publishedSuffix(path),
    }
  }
  const path = resolve(repoRoot, sample.path)
  return (await exists(path))
    ? { state: 'ready', path, publishedPath: sample.path }
    : corpusFailure(`corpus sample is missing: ${sample.path}`)
}

async function resolveSample(sample, temporaryRoot) {
  const located = await locateSample(sample, temporaryRoot)
  if (located.state !== 'ready') return located
  const bytes = await readFile(located.path)
  return {
    state: 'ready',
    path: located.path,
    provenance: {
      kind: sample.kind,
      origin:
        sample.rapid !== undefined
          ? 'rapid-pool-entry'
          : sample.container !== undefined
            ? 'container-entry'
            : typeof sample.environment === 'string'
              ? 'environment'
              : typeof sample.mk2Relative === 'string'
                ? 'legacy-checkout'
                : 'repository',
      ...(sample.environment === undefined ? {} : { environment: sample.environment }),
      relativePath: located.publishedPath,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  }
}

function runCanonicalProbe(sample, file) {
  const windowsPnpm =
    process.platform === 'win32'
      ? resolve(
          process.env.MODKIT_PARITY_PNPM_CLI ??
            join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
        )
      : undefined
  const command = windowsPnpm === undefined ? 'pnpm' : process.execPath
  const commandPrefix = windowsPnpm === undefined ? [] : [windowsPnpm]
  const request = Buffer.from(
    JSON.stringify({
      ...sample,
      file,
      canonicalRoot,
    }),
  ).toString('base64url')
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      command,
      [
        ...commandPrefix,
        '--dir',
        canonicalRoot,
        'exec',
        'tsx',
        join(import.meta.dirname, 'modkitx-probe.mjs'),
        request,
      ],
      { cwd: canonicalRoot, windowsHide: true },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`canonical probe exited ${String(code)}: ${stderr.trim()}`))
        return
      }
      const marker = stdout.split(/\r?\n/u).find(line => line.startsWith('MODKIT_PARITY_RESULT '))
      if (marker === undefined) {
        reject(new Error(`canonical probe returned no result: ${stdout.trim()} ${stderr.trim()}`))
        return
      }
      resolvePromise(JSON.parse(marker.slice('MODKIT_PARITY_RESULT '.length)))
    })
  })
}

async function smokeDataSource(session, contract, major, options) {
  const lease = await session.dataSource(contract, major)
  try {
    return await observeDataSource(contract, major, lease.value, options)
  } finally {
    await lease.release()
  }
}

async function probeX3(sample, file, temporaryRoot) {
  const extension = resolve(repoRoot, sample.x3Extension)
  const modkit = await createModkit({
    extensions: [extension],
    roots: [dirname(file), temporaryRoot],
    intent: 'full',
  })
  try {
    const opened = await modkit.open(file)
    if (opened.snapshot.state !== 'opened' || opened.session === undefined) {
      return { available: false, detail: opened.snapshot }
    }
    try {
      const descriptor = opened.snapshot.descriptor
      const declaredSources = descriptor.dataSources.map(source => source.contract).sort()
      const canExtractEntries = descriptor.operations.some(
        operation => operation.state === 'available' && operation.handlerId === 'extract-entry',
      )
      const sources = []
      for (const source of descriptor.dataSources) {
        try {
          const options =
            source.contract === 'common.view/namespace-entry-source' && canExtractEntries
              ? {
                  readNamespaceEntry: async entry => {
                    const extracted = await opened.session.operations().invoke('extract-entry', {
                      entryId: entry.id,
                    })
                    if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
                      throw new TypeError(`namespace extraction failed for ${entry.id}`)
                    }
                    const leaf = entry.path.split('/').at(-1) ?? 'entry.bin'
                    const safeLeaf = leaf.replaceAll(/[^A-Za-z0-9._-]/gu, '_')
                    const nestedPath = join(temporaryRoot, `${sample.format}-${safeLeaf}`)
                    await writeFile(nestedPath, extracted.output.value)
                    const nested = await modkit.open(nestedPath)
                    await nested.close()
                    return {
                      bytes: extracted.output.value.byteLength,
                      productReopenCompleted: true,
                    }
                  },
                }
              : undefined
          sources.push(
            await smokeDataSource(opened.session, source.contract, source.major, options),
          )
        } catch (error) {
          sources.push({
            contract: source.contract,
            major: source.major,
            state: 'failed',
            features: [],
            measurements: {},
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      }
      const model = sources.find(source => source.contract === 'common.view/model-scene-source')
      /*
       * The projection receipt is skipped, and not because it is uninteresting.
       *
       * A `ProjectionReceipt` carries `subjectRevision`, which is the host's per-open provider
       * token — it encodes the physical source and changes whenever the file is re-staged. Folding
       * it into this report would make the committed snapshot non-reproducible, and `parity:legacy`
       * exists precisely to prove the snapshot *is* reproducible. It is also not a comparable
       * measurement: the canonical reader emits no receipts at all, so the entry could only ever be
       * an X3-side extra. `comparableMetadataFeatures` already ignores it; this drops the body too.
       */
      const metadataSummary = Object.fromEntries(
        descriptor.metadata
          .filter(group => group.id !== PROJECTION_RECEIPT_GROUP)
          .flatMap(group => group.entries.map(entry => [entry.key, entry.value])),
      )
      const operations = descriptor.operations
        .filter(operation => operation.state === 'available')
        .map(operation => operation.id)
        .sort()
      const features = [
        ...sources
          .filter(source => source.state === 'opened')
          .map(source => `source:${source.contract}`),
        ...comparableMetadataFeatures(metadataSummary),
        ...(model?.measurements?.decodedGeometry === true ? ['geometry:decoded'] : []),
        ...operations.map(operation => `operation:${operation}`),
      ].sort()
      return {
        available: true,
        formatId: descriptor.identity.formatId,
        declaredSources,
        actualSources: sources
          .filter(source => source.state === 'opened')
          .map(source => source.contract)
          .sort(),
        sourceFailures: sources
          .filter(source => source.state === 'failed')
          .map(source => ({ contract: source.contract, error: source.detail })),
        sources: sources.sort((left, right) => left.contract.localeCompare(right.contract)),
        operations,
        geometryAccess: model?.measurements?.decodedGeometry === true ? 'decoded' : 'unavailable',
        metadata: metadataSummary,
        features,
      }
    } finally {
      await opened.close()
    }
  } finally {
    await modkit.close()
  }
}

function compact(result) {
  if (result.state === 'skipped') return result.detail
  if (result.state === 'failed') return result.detail
  const canonical = result.canonical
  const x3 = result.x3
  if (x3?.available === false)
    return `canon ${canonical.actualSources.length} source(s); X3 did not open`
  return `canon ${canonical.geometryAccess}, ${canonical.actualSources.length} source(s); X3 ${x3.geometryAccess}, ${x3.actualSources.length} source(s)`
}

function identity(sample) {
  return {
    id: sample.id,
    format: sample.format,
    kind: sample.kind,
    contributionId: sample.contributionId,
  }
}

async function evaluateSample(sample, temporaryRoot) {
  const resolved = await resolveSample(sample, temporaryRoot)
  if (resolved.state === 'skipped') {
    return {
      ...identity(sample),
      state: 'skipped',
      sample: sample.environment ?? sample.mk2Relative ?? sample.path ?? sample.generatedFrom,
      detail: resolved.detail,
    }
  }
  if (resolved.state === 'failed') {
    return { ...identity(sample), state: 'failed', detail: resolved.detail }
  }
  try {
    const [canonical, x3] = await Promise.all([
      runCanonicalProbe(sample, resolved.path),
      probeX3(sample, resolved.path, temporaryRoot),
    ])
    if (
      sample.expectFormatId !== undefined &&
      x3.available &&
      x3.formatId !== sample.expectFormatId
    ) {
      return {
        ...identity(sample),
        state: 'failed',
        provenance: resolved.provenance,
        detail: `corpus sample is not ${sample.expectFormatId}: X3 identified ${x3.formatId}`,
      }
    }
    const comparison = classifyFormatParity(canonical, x3, x3.available)
    return {
      ...identity(sample),
      state: 'compared',
      sample: sample.environment ?? sample.mk2Relative ?? sample.path ?? sample.generatedFrom,
      provenance: resolved.provenance,
      classification: comparison.classification,
      missing: comparison.missing,
      extra: comparison.extra,
      sourceComparisons: comparison.sources,
      ...(sample.baseline === undefined ? {} : { baseline: sample.baseline }),
      ...(sample.allowPoorerReason === undefined
        ? {}
        : { allowPoorerReason: sample.allowPoorerReason }),
      canonical,
      x3,
    }
  } catch (error) {
    return {
      ...identity(sample),
      state: 'failed',
      provenance: resolved.provenance,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = Array.from({ length: items.length })
  let next = 0
  async function pump() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, pump))
  return results
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'modkit-parity-'))
try {
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8'))
  const canonicalSha = gitSha(canonicalRoot)
  const x3Sha = gitSha(repoRoot)
  const results = await mapWithConcurrency(corpus.samples, CONCURRENCY, sample =>
    evaluateSample(sample, temporaryRoot),
  )
  const report = buildParityReport({
    corpus: corpusPath,
    canonical: { root: canonicalRoot, sha: canonicalSha },
    x3: { root: repoRoot, sha: x3Sha },
    results,
  })
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, await formatWithPrettier(JSON.stringify(report), { parser: 'json' }))
  console.log(`canonical SHA: ${canonicalSha}`)
  console.log(`X3 SHA:        ${x3Sha}`)
  console.log('format                     kind       state     verdict       detail')
  for (const result of report.results) {
    console.log(
      `${result.format.padEnd(26)} ${(result.kind ?? '—').padEnd(10)} ${result.state.padEnd(9)} ${(result.verdict ?? '—').padEnd(13)} ${compact(result)}`,
    )
  }
  const counts = report.counts
  console.log(
    `rows ${counts.total}: ${counts.real} real, ${counts.synthetic} synthetic; ` +
      `${counts.compared} compared, ${counts.skipped} skipped, ${counts.failed} failed`,
  )
  console.log(
    `verdicts: ${counts.richer} richer, ${counts.equal} equal, ${counts.poorer} poorer, ` +
      `${counts.incomparable} incomparable`,
  )
  console.log(`parity report: ${outputPath}`)
  const blocking = blockingParityResults(report.results)
  for (const result of blocking) {
    console.error(
      `blocking: ${result.format} ${result.state} ${result.classification ?? ''} ${result.detail ?? ''}`,
    )
  }
  if (blocking.length > 0) process.exitCode = 1
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
