import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createModkit } from '@modkitx-x3/host/node'
import { format as formatWithPrettier } from 'prettier'
import { classifyFormatParity, comparableMetadataFeatures } from './classify.mjs'
import { observeDataSource } from './observe.mjs'
import { blockingParityResults, buildParityReport, gitSha } from './report.mjs'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const canonicalRoot = resolve(
  process.env.MODKIT_PARITY_CANON_ROOT ?? join(repoRoot, '..', 'modkitx'),
)
const corpusPath = resolve(
  process.env.MODKIT_PARITY_CORPUS ?? join(import.meta.dirname, 'corpus.json'),
)
const outputPath = resolve(
  process.env.MODKIT_PARITY_REPORT ?? join(repoRoot, 'reports', 'parity', 'latest.json'),
)

async function exists(path) {
  return (await stat(path).catch(() => undefined))?.isFile() === true
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

async function resolveSample(sample, temporaryRoot) {
  if (typeof sample.environment === 'string') {
    const value = process.env[sample.environment]
    if (value === undefined || value.trim() === '') {
      return { state: 'skipped', detail: `${sample.environment} is not set` }
    }
    const path = resolve(value, sample.relativePath ?? '')
    return (await exists(path))
      ? { state: 'ready', path }
      : { state: 'skipped', detail: `${sample.environment} does not name a file: ${path}` }
  }
  if (typeof sample.generatedFrom === 'string') {
    const source = resolve(repoRoot, sample.generatedFrom)
    const path = join(temporaryRoot, `${sample.format}.glb`)
    await makeGlb(source, path)
    return { state: 'ready', path }
  }
  const path = resolve(repoRoot, sample.path)
  return (await exists(path))
    ? { state: 'ready', path }
    : { state: 'skipped', detail: `corpus sample is missing: ${path}` }
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
      const sources = []
      for (const source of descriptor.dataSources) {
        try {
          const options =
            source.contract === 'common.view/namespace-entry-source'
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
      const metadataSummary = Object.fromEntries(
        descriptor.metadata.flatMap(group => group.entries.map(entry => [entry.key, entry.value])),
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
  return `canon ${canonical.geometryAccess}, ${canonical.actualSources.length} source(s); X3 ${x3.geometryAccess}, ${x3.actualSources.length} source(s)`
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'modkit-parity-'))
try {
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8'))
  const canonicalSha = gitSha(canonicalRoot)
  const x3Sha = gitSha(repoRoot)
  const results = []
  for (const sample of corpus.samples) {
    const resolved = await resolveSample(sample, temporaryRoot)
    if (resolved.state === 'skipped') {
      results.push({
        format: sample.format,
        state: 'skipped',
        sample: sample.environment ?? sample.path ?? sample.generatedFrom,
        detail: resolved.detail,
      })
      continue
    }
    try {
      const [canonical, x3] = await Promise.all([
        runCanonicalProbe(sample, resolved.path),
        probeX3(sample, resolved.path, temporaryRoot),
      ])
      const comparison = classifyFormatParity(canonical, x3, x3.available)
      results.push({
        format: sample.format,
        state: 'compared',
        sample: sample.environment ?? sample.path ?? sample.generatedFrom,
        classification: comparison.classification,
        missing: comparison.missing,
        extra: comparison.extra,
        sourceComparisons: comparison.sources,
        ...(sample.allowPoorerReason === undefined
          ? {}
          : { allowPoorerReason: sample.allowPoorerReason }),
        canonical,
        x3,
      })
    } catch (error) {
      results.push({
        format: sample.format,
        state: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
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
  console.log('format  state     classification  detail')
  for (const result of results) {
    console.log(
      `${result.format.padEnd(7)} ${result.state.padEnd(9)} ${(result.classification ?? '—').padEnd(15)} ${compact(result)}`,
    )
  }
  console.log(`parity report: ${outputPath}`)
  if (blockingParityResults(report.results).length > 0) process.exitCode = 1
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
