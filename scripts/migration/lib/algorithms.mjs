import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import ts from 'typescript'
import { sha256 } from './legacy-oracle.mjs'

export const algorithmPattern =
  /^(?:crc32|adler32|inflate\w*|mpqHash|parseXml\w*|boundsOf|decodeBc\w*|decodeAdpcm\w*|sha1\w*|md5\w*)$/iu
export const algorithmRepositories = [
  'modkit-core',
  'modkit-extensions-blizzard',
  'modkit-extensions-ea',
  'modkit-extensions-other',
  'modkit-extensions-spring',
  'modkit-extensions-warzone',
]
export const SC2_ALGORITHM_PRODUCTION_TSCONFIG =
  'modkit-extensions-blizzard/starcraft2/tsconfig.json'
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-app',
  'build',
  'out',
  'coverage',
  'vendor',
  'test',
  'tests',
  '__tests__',
  'fixtures',
  'artifacts',
  'reports', // Versioned evidence snapshots are not product implementations.
  '.cache',
  '.turbo',
])

/** Definitions only: calls, comments, strings and imported declarations are not implementations. */
export function algorithmDefinitions(text, filename) {
  const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true)
  if (file.parseDiagnostics.length) throw new Error(`Cannot parse algorithm source: ${filename}`)
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
  const definitions = []
  const counts = new Map()
  function visit(node, parents) {
    let name
    let body
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      node.body
    ) {
      name = node.name.getText(file).replace(/^['"]|['"]$/gu, '')
      body = node.body
    } else if (
      (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      name = node.name.getText(file).replace(/^['"]|['"]$/gu, '')
      body = node.initializer.body
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isArrowFunction(node.right) || ts.isFunctionExpression(node.right))
    ) {
      name = ts.isPropertyAccessExpression(node.left)
        ? node.left.name.text
        : ts.isElementAccessExpression(node.left) &&
            ts.isStringLiteral(node.left.argumentExpression)
          ? node.left.argumentExpression.text
          : node.left.getText(file)
      body = node.right.body
    }
    if (name && body && algorithmPattern.test(name)) {
      const symbol = [...parents, name].join('.')
      const ordinal = counts.get(symbol) ?? 0
      counts.set(symbol, ordinal + 1)
      definitions.push({
        symbol: `${symbol}#${ordinal}`,
        name,
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        implementationSha256: sha256(printer.printNode(ts.EmitHint.Unspecified, node, file)),
      })
    }
    const container =
      (ts.isClassDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isModuleDeclaration(node)) &&
      node.name
        ? node.name.getText(file)
        : null
    ts.forEachChild(node, child => visit(child, container ? [...parents, container] : parents))
  }
  visit(file, [])
  return definitions
}

function trustedWorkspacePath(workspaceRoot, relative, label) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    relative.includes('\\') ||
    path.posix.isAbsolute(relative) ||
    relative.split('/').some(part => !part || part === '.' || part === '..')
  )
    throw new Error(`Invalid ${label}: ${relative}`)
  const absolute = path.resolve(workspaceRoot, relative)
  const inside = path.relative(path.resolve(workspaceRoot), absolute)
  if (inside.startsWith('..') || path.isAbsolute(inside))
    throw new Error(`${label} escapes workspace: ${relative}`)
  return absolute
}

function runtimeStrings(value, results = []) {
  if (typeof value === 'string') results.push(value)
  else if (Array.isArray(value))
    for (const child of value) runtimeStrings(child, results)
  else if (value && typeof value === 'object' && !Array.isArray(value))
    for (const child of Object.values(value)) runtimeStrings(child, results)
  return results
}

/** Resolve every public SC2 runtime entrypoint to its authored TypeScript source. */
export async function sc2RuntimeSurfaceRoots({
  workspaceRoot,
  packageRoot = 'modkit-extensions-blizzard/starcraft2',
}) {
  const packagePath = trustedWorkspacePath(workspaceRoot, packageRoot, 'SC2 package root')
  const manifest = JSON.parse(await readFile(path.join(packagePath, 'package.json'), 'utf8'))
  if (
    JSON.stringify(manifest.modkit?.contributionManifests) !==
    JSON.stringify(['./contributions/*.json'])
  )
    throw new Error('Unexpected SC2 contribution manifest inventory pattern')
  const entries = runtimeStrings(manifest.exports)
  if (typeof manifest.bin === 'string') entries.push(manifest.bin)
  else if (manifest.bin && typeof manifest.bin === 'object') entries.push(...Object.values(manifest.bin))
  const contributionsPath = path.join(packagePath, 'contributions')
  const contributionFiles = (await readdir(contributionsPath, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (!contributionFiles.length) throw new Error('Empty SC2 contribution runtime inventory')
  for (const file of contributionFiles) {
    const contribution = JSON.parse(
      await readFile(path.join(contributionsPath, file.name), 'utf8'),
    )
    for (const variant of contribution.runtimeVariants ?? []) {
      if (typeof variant.entrypoint !== 'string')
        throw new Error(`Invalid SC2 contribution runtime entrypoint: ${file.name}`)
      entries.push(variant.entrypoint)
    }
  }
  const roots = new Set()
  const existing = async candidates => {
    for (const candidate of candidates)
      try {
        await readFile(candidate)
        return candidate
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    return null
  }
  for (const entry of entries) {
    if (entry === './package.json' || /\.d\.[cm]?ts$/u.test(entry)) continue
    let absolute
    if (/^\.\/src\/.*\.[cm]?js$/u.test(entry)) {
      const runtime = path.join(packagePath, ...entry.slice(2).split('/'))
      const stem = runtime.replace(/\.[cm]?js$/u, '')
      absolute = await existing([
        runtime,
        `${stem}.ts`,
        `${stem}.tsx`,
        `${stem}.mts`,
        `${stem}.cts`,
      ])
    } else if (/^\.\/dist\/.*\.[cm]?js$/u.test(entry)) {
      const sourceStem = path
        .join(packagePath, 'src', ...entry.slice(7).split('/'))
        .replace(/\.[cm]?js$/u, '')
      absolute = await existing([
        `${sourceStem}.ts`,
        `${sourceStem}.tsx`,
        `${sourceStem}.mts`,
        `${sourceStem}.cts`,
      ])
    }
    else throw new Error(`Unsupported SC2 runtime surface entrypoint: ${entry}`)
    if (!absolute) throw new Error(`Missing SC2 runtime surface source: ${entry}`)
    roots.add(path.relative(workspaceRoot, absolute).split(path.sep).join('/'))
  }
  if (!roots.size) throw new Error('Empty SC2 runtime surface roots')
  return [...roots].sort()
}

export function validateCopiedUnwiredAllowanceIds(records, expectedIds) {
  const actual = records.map(
    record => `${record.destination}:${record.algorithmDisposition?.symbol ?? '<unset>'}`,
  )
  const actualSet = new Set(actual)
  const expectedSet = new Set(expectedIds)
  if (
    actualSet.size !== actual.length ||
    expectedSet.size !== expectedIds.length ||
    actualSet.size !== expectedSet.size ||
    [...actualSet].some(id => !expectedSet.has(id))
  )
    throw new Error(`Unexpected copied-unwired algorithm allowance: ${actual.join(', ')}`)
  return records
}

export async function scanAlgorithms({
  workspaceRoot,
  repositories = algorithmRepositories,
  canonicalFiles = [],
  copiedUnwiredFiles = [],
  productionTsconfig,
  runtimeSurfaceRoots = [],
}) {
  const canonical = new Map()
  const sourceDestinations = new Map()
  for (const record of canonicalFiles) {
    if (canonical.has(record.destination))
      throw new Error(`Duplicate canonical algorithm destination: ${record.destination}`)
    if (sourceDestinations.has(record.mk2Path))
      throw new Error(`Multiple canonical paths for source: ${record.mk2Path}`)
    canonical.set(record.destination, record)
    sourceDestinations.set(record.mk2Path, record.destination)
  }
  const copiedUnwired = new Map()
  const copiedUnwiredByDestination = new Map()
  for (const record of copiedUnwiredFiles) {
    const disposition = record.algorithmDisposition
    if (
      !record.mk2Path ||
      !record.destination ||
      !/^[a-f0-9]{64}$/u.test(record.sha256Mk3 ?? '') ||
      !disposition ||
      disposition.kind !== 'copied-unwired-copy' ||
      typeof disposition.symbol !== 'string' ||
      !disposition.symbol ||
      Object.keys(disposition).sort().join(',') !== 'exit,kind,reason,symbol'
    )
      throw new Error(`Invalid copied-unwired algorithm record: ${record.destination ?? '<unset>'}`)
    if (canonical.has(record.destination))
      throw new Error(`Algorithm destination cannot be canonical and copied-unwired: ${record.destination}`)
    const id = `${record.destination}:${disposition.symbol}`
    if (copiedUnwired.has(id))
      throw new Error(`Duplicate copied-unwired algorithm disposition: ${id}`)
    copiedUnwired.set(id, { record, disposition, hits: 0 })
    const peers = copiedUnwiredByDestination.get(record.destination) ?? []
    peers.push({ record, disposition })
    copiedUnwiredByDestination.set(record.destination, peers)
  }
  if (copiedUnwired.size) {
    if (productionTsconfig !== SC2_ALGORITHM_PRODUCTION_TSCONFIG)
      throw new Error('Trusted SC2 production tsconfig is required for copied-unwired algorithms')
    const configPath = trustedWorkspacePath(
      workspaceRoot,
      productionTsconfig,
      'copied-unwired production tsconfig',
    )
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile)
    if (loaded.error)
      throw new Error(
        `Cannot read copied-unwired production tsconfig: ${productionTsconfig}: ${ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n')}`,
      )
    const parsed = ts.parseJsonConfigFileContent(
      loaded.config,
      ts.sys,
      path.dirname(configPath),
      undefined,
      configPath,
    )
    if (parsed.errors.length)
      throw new Error(
        `Cannot parse copied-unwired production tsconfig: ${productionTsconfig}: ${parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('; ')}`,
      )
    if (!runtimeSurfaceRoots.length) throw new Error('Trusted SC2 runtime surface roots are required')
    const surfaceRoots = runtimeSurfaceRoots.map(relative =>
      trustedWorkspacePath(workspaceRoot, relative, 'SC2 runtime surface root'),
    )
    const program = ts.createProgram({
      rootNames: [...new Set([...parsed.fileNames, ...surfaceRoots])],
      options: { ...parsed.options, allowJs: true, checkJs: false, noEmit: true },
      projectReferences: parsed.projectReferences,
    })
    const normalize = value =>
      process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value)
    const active = new Set(program.getSourceFiles().map(file => normalize(file.fileName)))
    for (const { record } of copiedUnwired.values())
      if (active.has(normalize(path.resolve(workspaceRoot, record.destination))))
        throw new Error(`copied-unwired algorithm became active: ${record.destination}`)
  }
  const implementations = []
  const scanned = []
  for (const repository of repositories) {
    let sourceFiles = 0
    async function visit(relative) {
      const entries = await readdir(path.join(workspaceRoot, relative), { withFileTypes: true })
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const file = `${relative}/${entry.name}`
        // Archived pre-externalization fixtures are historical evidence, not active repository code.
        if (
          file.startsWith(`${repository}/migration/history/`) ||
          file === `${repository}/migration/history`
        )
          continue
        if (entry.isDirectory()) {
          if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith('.')) await visit(file)
        } else if (
          /\.[cm]?[jt]sx?$/u.test(entry.name) &&
          !/\.d\.[cm]?ts$/u.test(entry.name) &&
          !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)
        ) {
          sourceFiles++
          const bytes = await readFile(path.join(workspaceRoot, file))
          const known = canonical.get(file)
          if (known && sha256(bytes) !== known.sha256Mk3)
            throw new Error(`Canonical algorithm copy hash mismatch: ${file}`)
          const staged = copiedUnwiredByDestination.get(file) ?? []
          if (staged.length && staged.some(item => sha256(bytes) !== item.record.sha256Mk3))
            throw new Error(`Copied-unwired algorithm copy hash mismatch: ${file}`)
          for (const definition of algorithmDefinitions(bytes.toString('utf8'), file)) {
            const temporary = copiedUnwired.get(`${file}:${definition.symbol}`)
            if (temporary) temporary.hits++
            implementations.push({
              id: `${file}:${definition.symbol}`,
              repository,
              path: file,
              ...definition,
              disposition: known
                ? 'canonical-copy'
                : temporary
                  ? 'copied-unwired-copy'
                  : 'existing-debt',
              ...(known
                ? { mk2Path: known.mk2Path }
                : temporary
                  ? {
                      mk2Path: temporary.record.mk2Path,
                      reason: temporary.disposition.reason,
                      exit: temporary.disposition.exit,
                    }
                  : {}),
            })
          }
        }
      }
    }
    await visit(repository)
    if (!sourceFiles) throw new Error(`Empty repository algorithm scan: ${repository}`)
    scanned.push({ repository, sourceFiles })
  }
  for (const [id, temporary] of copiedUnwired)
    if (temporary.hits !== 1)
      throw new Error(
        `Stale copied-unwired algorithm disposition: ${id} (found ${temporary.hits})`,
      )
  implementations.sort((a, b) => a.id.localeCompare(b.id))
  return { schemaVersion: 1, scanned, implementations }
}

export function checkAlgorithmDebt(current, baseline) {
  if (
    baseline.schemaVersion !== 1 ||
    !Array.isArray(baseline.implementations) ||
    !baseline.implementations.length
  )
    throw new Error('Empty/invalid algorithm baseline')
  if (
    JSON.stringify(current.scanned.map(row => row.repository)) !==
    JSON.stringify(baseline.scanned.map(row => row.repository))
  )
    throw new Error('Algorithm repository scope differs from baseline')
  const previous = new Map()
  for (const row of baseline.implementations) {
    if (previous.has(row.id)) throw new Error(`Duplicate baseline algorithm: ${row.id}`)
    previous.set(row.id, row)
  }
  const failures = []
  for (const row of current.implementations) {
    if (row.disposition === 'canonical-copy' || row.disposition === 'copied-unwired-copy') continue
    const old = previous.get(row.id)
    if (!old || old.disposition !== 'existing-debt')
      failures.push(`New undeclared algorithm implementation: ${row.id}`)
    else if (old.implementationSha256 !== row.implementationSha256)
      failures.push(`Existing algorithm debt changed without migration: ${row.id}`)
  }
  return {
    failures,
    debt: current.implementations.filter(row => row.disposition === 'existing-debt').length,
    canonical: current.implementations.filter(row => row.disposition === 'canonical-copy').length,
    copiedUnwired: current.implementations.filter(
      row => row.disposition === 'copied-unwired-copy',
    ).length,
    new: failures.filter(failure => failure.startsWith('New undeclared algorithm implementation:'))
      .length,
    retired: baseline.implementations
      .filter(
        row =>
          row.disposition === 'existing-debt' &&
          !current.implementations.some(
            item => item.id === row.id && item.disposition === 'existing-debt',
          ),
      )
      .map(row => row.id),
  }
}

/** Temporary copied-unwired classifications are execution guards, never debt allowances. */
export function ratchetAlgorithmSnapshot(current) {
  return {
    ...current,
    implementations: current.implementations.filter(
      row => row.disposition !== 'copied-unwired-copy',
    ),
  }
}

/** A checked-in debt allowance can only shrink; editing its JSON cannot bless a new peer. */
export function checkBaselineRatchet(baseline, previous) {
  const oldDebt = new Map(
    previous.implementations
      .filter(row => row.disposition === 'existing-debt')
      .map(row => [row.id, row]),
  )
  const failures = []
  for (const row of baseline.implementations.filter(item => item.disposition === 'existing-debt')) {
    const old = oldDebt.get(row.id)
    if (!old) failures.push(`Baseline introduces algorithm debt: ${row.id}`)
    else if (old.implementationSha256 !== row.implementationSha256)
      failures.push(`Baseline changes existing algorithm allowance: ${row.id}`)
  }
  return failures
}
