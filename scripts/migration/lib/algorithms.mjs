import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { sha256 } from './legacy-oracle.mjs'

export const algorithmPattern =
  /^(?:crc32|adler32|inflate\w*|mpqHash|parseXml\w*|boundsOf|invertAffine|decompose\w*|quaternionFrom\w*|decodeBc\w*|encodeDxt\w*|parsePalette|applyPalette|wavHeader|encodeWav|encodeOgg|decodeFadpcm|decodeXaAdpcm|cdRomEdc|edc32|decodeTga\w*|parseTga|parseSylk|decodeAdpcm\w*|decodeLcw\w*|applyFormat40|decodeLzo\w*|sha1\w*|md5\w*)$/iu
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
export const SC2_ARCHIVE_M4_PROVENANCE =
  'modkit-extensions-blizzard/starcraft2/src/lib/mk2/compat/archive-m4-provenance.json'
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

export const MPQ_HASH_CANONICAL_PATH = 'modkit-core/packages/codec-kit/src/crypto/mpq.ts'
export const MPQ_HASH_CANONICAL_MODULE = '@modkit/codec-kit/crypto'
export const MPQ_HASH_BINDING_PATHS = Object.freeze([
  'modkit-extensions-blizzard/mpq/src/mpq/codec.js',
  'modkit-extensions-blizzard/mpq/src/mpq/fresh-writer.js',
  'modkit-extensions-blizzard/mpq/src/mpq/native-preserving.js',
])
export const MPQ_HASH_VECTORS = Object.freeze([
  Object.freeze({ input: 'replay.details', type: 1, expected: 0xd383c29c }),
  Object.freeze({ input: 'REPLAY.DETAILS', type: 1, expected: 0xd383c29c }),
  Object.freeze({ input: 'Base.SC2Data/GameData', type: 1, expected: 0xd621e5a7 }),
  Object.freeze({ input: 'Base.SC2Data\\GameData', type: 1, expected: 0xd39a597a }),
  Object.freeze({ input: 'Café/Ünit', type: 1, expected: 0x3974cb8c }),
])

/** Definitions only: calls, comments, strings and imported declarations are not implementations. */
export function algorithmDefinitions(text, filename, additionalNames = []) {
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
    if (name && body && (algorithmPattern.test(name) || additionalNames.includes(name))) {
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

function importedMpqHashBindings(text, filename) {
  const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true)
  if (file.parseDiagnostics.length) throw new Error(`Cannot parse MPQ hash consumer: ${filename}`)
  const imports = []
  const namespaceImports = new Map()
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue
    const module = statement.moduleSpecifier.text
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text
        const local = element.name.text
        if (imported === 'mpqHash' || local === 'mpqHash') imports.push({ module, imported, local })
      }
    else if (bindings && ts.isNamespaceImport(bindings))
      namespaceImports.set(bindings.name.text, module)
  }
  const namespaceUses = []
  const shadowing = []
  let directCalls = 0
  function visit(node) {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isImportEqualsDeclaration(node) ||
        ts.isBindingElement(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'mpqHash'
    )
      shadowing.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
    else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      node.left.text === 'mpqHash'
    )
      shadowing.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'mpqHash') directCalls++
      else if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'mpqHash' &&
        ts.isIdentifier(node.expression.expression) &&
        namespaceImports.has(node.expression.expression.text)
      )
        namespaceUses.push({
          module: namespaceImports.get(node.expression.expression.text),
          imported: 'mpqHash',
          local: `${node.expression.expression.text}.mpqHash`,
        })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return { imports: [...imports, ...namespaceUses], directCalls, shadowing }
}

/**
 * Prove the M4 mpqHash 4 -> 1 decision with AST definitions, exact active bindings and
 * behavior vectors executed from the canonical TypeScript source.
 */
export async function checkMpqHashCanonicalization({ current, workspaceRoot }) {
  const failures = []
  const definitions = current?.implementations?.filter(row => row.name === 'mpqHash') ?? []
  const canonical = definitions.filter(
    row =>
      row.repository === 'modkit-core' &&
      row.path === MPQ_HASH_CANONICAL_PATH &&
      row.symbol === 'mpqHash#0' &&
      row.disposition.startsWith('canonical-'),
  )
  const blizzardDefinitions = definitions.filter(
    row => row.repository === 'modkit-extensions-blizzard',
  )
  if (definitions.length !== 1)
    failures.push(
      `expected exactly one mpqHash definition across the algorithm scan, found ${definitions.length}: ${definitions.map(row => row.id).join(', ') || '<none>'}`,
    )
  if (canonical.length !== 1)
    failures.push(
      `expected canonical mpqHash definition ${MPQ_HASH_CANONICAL_PATH}:mpqHash#0, found ${canonical.length}`,
    )
  if (blizzardDefinitions.length)
    failures.push(
      `expected zero Blizzard mpqHash definitions, found: ${blizzardDefinitions.map(row => row.id).join(', ')}`,
    )

  const bindingRoots = [
    'modkit-extensions-blizzard/mpq/src',
    'modkit-extensions-blizzard/starcraft2/src',
  ]
  const bindings = []
  async function visitBindings(relative) {
    const entries = await readdir(
      trustedWorkspacePath(workspaceRoot, relative, 'MPQ binding root'),
      {
        withFileTypes: true,
      },
    )
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith('.'))
          await visitBindings(child)
      } else if (
        /\.[cm]?[jt]sx?$/u.test(entry.name) &&
        !/\.d\.[cm]?ts$/u.test(entry.name) &&
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)
      ) {
        const source = await readFile(trustedWorkspacePath(workspaceRoot, child, 'MPQ consumer'))
        const result = importedMpqHashBindings(source.toString('utf8'), child)
        for (const binding of result.imports) bindings.push({ path: child, ...binding })
        if (result.shadowing.length)
          failures.push(
            `local mpqHash binding or reassignment in ${child}:${result.shadowing.join(',')}`,
          )
        if (MPQ_HASH_BINDING_PATHS.includes(child)) {
          const exact = result.imports.filter(
            binding =>
              binding.module === MPQ_HASH_CANONICAL_MODULE &&
              binding.imported === 'mpqHash' &&
              binding.local === 'mpqHash',
          )
          if (exact.length !== 1 || result.directCalls === 0)
            failures.push(
              `expected ${child} to directly import and call mpqHash from ${MPQ_HASH_CANONICAL_MODULE}`,
            )
        }
      }
    }
  }
  for (const root of bindingRoots) await visitBindings(root)
  for (const expected of MPQ_HASH_BINDING_PATHS)
    if (!bindings.some(binding => binding.path === expected))
      failures.push(`missing planned canonical mpqHash binding: ${expected}`)
  for (const binding of bindings)
    if (
      binding.module !== MPQ_HASH_CANONICAL_MODULE ||
      binding.imported !== 'mpqHash' ||
      binding.local !== 'mpqHash'
    )
      failures.push(
        `non-canonical mpqHash binding: ${binding.path} imports ${binding.imported} as ${binding.local} from ${binding.module}`,
      )

  const canonicalSource = await readFile(
    trustedWorkspacePath(workspaceRoot, MPQ_HASH_CANONICAL_PATH, 'canonical MPQ hash source'),
    'utf8',
  )
  const transpiled = ts.transpileModule(canonicalSource, {
    fileName: MPQ_HASH_CANONICAL_PATH,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  const transpileErrors = (transpiled.diagnostics ?? []).filter(
    diagnostic => diagnostic.category === ts.DiagnosticCategory.Error,
  )
  if (transpileErrors.length)
    failures.push(
      `cannot execute canonical mpqHash vectors: ${transpileErrors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('; ')}`,
    )
  else {
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}#${sha256(canonicalSource)}`
    const loaded = await import(moduleUrl)
    if (typeof loaded.mpqHash !== 'function')
      failures.push('canonical source does not export mpqHash')
    else
      for (const vector of MPQ_HASH_VECTORS) {
        const actual = loaded.mpqHash(vector.input, vector.type)
        if (actual !== vector.expected)
          failures.push(
            `mpqHash vector failed for ${JSON.stringify(vector.input)}: expected 0x${vector.expected.toString(16)}, got 0x${Number(actual).toString(16)}`,
          )
      }
  }

  if (failures.length) throw new Error(`MPQ hash canonicalization failed:\n${failures.join('\n')}`)
  return Object.freeze({
    definitions: definitions.length,
    blizzardDefinitions: blizzardDefinitions.length,
    bindings: bindings.length,
    vectors: MPQ_HASH_VECTORS.length,
  })
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
  else if (Array.isArray(value)) for (const child of value) runtimeStrings(child, results)
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
  else if (manifest.bin && typeof manifest.bin === 'object')
    entries.push(...Object.values(manifest.bin))
  const contributionsPath = path.join(packagePath, 'contributions')
  const contributionFiles = (await readdir(contributionsPath, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (!contributionFiles.length) throw new Error('Empty SC2 contribution runtime inventory')
  for (const file of contributionFiles) {
    const contribution = JSON.parse(await readFile(path.join(contributionsPath, file.name), 'utf8'))
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
    } else throw new Error(`Unsupported SC2 runtime surface entrypoint: ${entry}`)
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

export function validateCanonicalOwnerIds(records, expectedIds) {
  const actual = records.map(record => record.id)
  const actualSet = new Set(actual)
  const expectedSet = new Set(expectedIds)
  if (
    actualSet.size !== actual.length ||
    expectedSet.size !== expectedIds.length ||
    actualSet.size !== expectedSet.size ||
    [...actualSet].some(id => !expectedSet.has(id))
  )
    throw new Error(`Unexpected canonical algorithm owner: ${actual.join(', ')}`)
  return records
}

function gitObject(repository, args, encoding) {
  try {
    return execFileSync('git', args, {
      cwd: repository,
      ...(encoding === undefined ? {} : { encoding }),
      windowsHide: true,
      maxBuffer: 128 * 1024 * 1024,
    })
  } catch (error) {
    throw new Error(`Cannot verify M4 archive provenance: git ${args.join(' ')}`, {
      cause: error,
    })
  }
}

/** Bind the seven temporary archive algorithms to the pinned MK2 ODB and exact M4 copy bytes. */
export async function loadArchiveM4AlgorithmAllowances({
  workspaceRoot,
  expectedIds,
  provenancePath = SC2_ARCHIVE_M4_PROVENANCE,
  oracleRoot = 'references/modkitmk2',
  expectedOracleCommit = '1a14ba4eddd0ae88de273348ebd44cfb98a0581d',
}) {
  const manifest = JSON.parse(
    await readFile(
      trustedWorkspacePath(workspaceRoot, provenancePath, 'M4 archive provenance'),
      'utf8',
    ),
  )
  if (
    manifest.schemaVersion !== 1 ||
    manifest.milestone !== 'M4/P11' ||
    manifest.disposition !== 'copied-unwired-test-compatibility' ||
    manifest.oracle?.repository !== oracleRoot ||
    manifest.oracle?.commit !== expectedOracleCommit ||
    manifest.oracle?.sourceMode !== 'git-object-database' ||
    !Array.isArray(manifest.copiedRoots) ||
    !manifest.copiedRoots.length ||
    !Array.isArray(manifest.algorithmAllowances)
  )
    throw new Error('Invalid M4 archive algorithm provenance')

  const repository = trustedWorkspacePath(workspaceRoot, oracleRoot, 'MK2 ODB repository')
  const roots = []
  const rootKeys = new Set()
  for (const root of manifest.copiedRoots) {
    if (
      Object.keys(root).sort().join(',') !== 'destination,gitObject,source' ||
      !/^[a-f0-9]{40}$/u.test(root.gitObject ?? '') ||
      !root.destination?.startsWith('starcraft2/src/lib/mk2/')
    )
      throw new Error('Invalid M4 archive copied root')
    trustedWorkspacePath(
      workspaceRoot,
      `modkit-extensions-blizzard/${root.destination}`,
      'M4 archive destination root',
    )
    trustedWorkspacePath(repository, root.source, 'M4 archive source root')
    const key = `${root.source}\0${root.destination}`
    if (rootKeys.has(key)) throw new Error(`Duplicate M4 archive copied root: ${root.source}`)
    rootKeys.add(key)
    const actual = gitObject(
      repository,
      ['rev-parse', '--verify', `${expectedOracleCommit}:${root.source}`],
      'utf8',
    ).trim()
    if (actual !== root.gitObject)
      throw new Error(`M4 archive copied root object mismatch: ${root.source}`)
    roots.push(root)
  }

  const records = []
  for (const allowance of manifest.algorithmAllowances) {
    if (
      Object.keys(allowance).sort().join(',') !==
        'destination,destinationImplementationSha256,destinationSha256,divergence,exit,reason,source,sourceBlob,sourceImplementationSha256,sourceSha256,symbol' ||
      !/^[a-f0-9]{40}$/u.test(allowance.sourceBlob ?? '') ||
      ![
        allowance.sourceSha256,
        allowance.destinationSha256,
        allowance.sourceImplementationSha256,
        allowance.destinationImplementationSha256,
      ].every(value => /^[a-f0-9]{64}$/u.test(value ?? '')) ||
      typeof allowance.symbol !== 'string' ||
      !allowance.symbol ||
      typeof allowance.reason !== 'string' ||
      !allowance.reason ||
      allowance.exit !== 'Canonicalize before any production activation.' ||
      (allowance.divergence !== null && allowance.divergence !== 'registered-compatibility-barrel')
    )
      throw new Error(
        `Invalid M4 archive algorithm allowance: ${allowance.destination ?? '<unset>'}`,
      )
    const matchingRoots = roots.filter(root => {
      const sourceSuffix = allowance.source.slice(root.source.length)
      return (
        (allowance.source === root.source || allowance.source.startsWith(`${root.source}/`)) &&
        allowance.destination === `${root.destination}${sourceSuffix}`
      )
    })
    if (matchingRoots.length !== 1)
      throw new Error(`M4 archive algorithm is outside one copied root: ${allowance.source}`)
    trustedWorkspacePath(repository, allowance.source, 'M4 archive algorithm source')

    const sourceBlob = gitObject(
      repository,
      ['rev-parse', '--verify', `${expectedOracleCommit}:${allowance.source}`],
      'utf8',
    ).trim()
    if (sourceBlob !== allowance.sourceBlob)
      throw new Error(`M4 archive algorithm source blob mismatch: ${allowance.source}`)
    const sourceBytes = gitObject(repository, ['cat-file', 'blob', sourceBlob])
    if (sha256(sourceBytes) !== allowance.sourceSha256)
      throw new Error(`M4 archive algorithm source hash mismatch: ${allowance.source}`)
    const destination = `modkit-extensions-blizzard/${allowance.destination}`
    const destinationBytes = await readFile(
      trustedWorkspacePath(workspaceRoot, destination, 'M4 archive algorithm destination'),
    )
    if (sha256(destinationBytes) !== allowance.destinationSha256)
      throw new Error(`M4 archive algorithm destination hash mismatch: ${destination}`)
    const sourceDefinition = algorithmDefinitions(
      sourceBytes.toString('utf8'),
      allowance.source,
    ).filter(row => row.symbol === allowance.symbol)
    const destinationDefinition = algorithmDefinitions(
      destinationBytes.toString('utf8'),
      destination,
    ).filter(row => row.symbol === allowance.symbol)
    if (
      sourceDefinition.length !== 1 ||
      destinationDefinition.length !== 1 ||
      sourceDefinition[0].implementationSha256 !== allowance.sourceImplementationSha256 ||
      destinationDefinition[0].implementationSha256 !== allowance.destinationImplementationSha256 ||
      (allowance.divergence === null &&
        sourceDefinition[0].implementationSha256 !== destinationDefinition[0].implementationSha256)
    )
      throw new Error(
        `M4 archive algorithm implementation mismatch: ${destination}:${allowance.symbol}`,
      )
    records.push({
      mk2Path: allowance.source,
      destination,
      sha256Mk3: allowance.destinationSha256,
      algorithmDisposition: {
        symbol: allowance.symbol,
        kind: 'copied-unwired-copy',
        reason: allowance.reason,
        exit: allowance.exit,
      },
    })
  }
  return validateCopiedUnwiredAllowanceIds(records, expectedIds)
}

export async function scanAlgorithms({
  workspaceRoot,
  repositories = algorithmRepositories,
  canonicalFiles = [],
  canonicalOwnedAlgorithms = [],
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
      throw new Error(
        `Algorithm destination cannot be canonical and copied-unwired: ${record.destination}`,
      )
    const id = `${record.destination}:${disposition.symbol}`
    if (copiedUnwired.has(id))
      throw new Error(`Duplicate copied-unwired algorithm disposition: ${id}`)
    copiedUnwired.set(id, { record, disposition, hits: 0 })
    const peers = copiedUnwiredByDestination.get(record.destination) ?? []
    peers.push({ record, disposition })
    copiedUnwiredByDestination.set(record.destination, peers)
  }
  const canonicalOwned = new Map()
  const canonicalOwnedByPath = new Map()
  const additionalNames = []
  for (const record of canonicalOwnedAlgorithms) {
    if (
      Object.keys(record).sort().join(',') !==
        'id,name,path,reason,repository,sourceSha256,symbol' ||
      record.id !== `${record.path}:${record.symbol}` ||
      record.symbol !== `${record.name}#0` ||
      !repositories.includes(record.repository) ||
      !record.path.startsWith(`${record.repository}/`) ||
      !/^[a-f0-9]{64}$/u.test(record.sourceSha256 ?? '') ||
      typeof record.reason !== 'string' ||
      !record.reason
    )
      throw new Error(`Invalid canonical algorithm owner: ${record.id ?? '<unset>'}`)
    if (canonicalOwned.has(record.id))
      throw new Error(`Duplicate canonical algorithm owner: ${record.id}`)
    if (canonical.has(record.path))
      throw new Error(
        `Algorithm path cannot be a copied and authored canonical owner: ${record.path}`,
      )
    canonicalOwned.set(record.id, { record, hits: 0 })
    const peers = canonicalOwnedByPath.get(record.path) ?? []
    if (peers.length && peers[0].sourceSha256 !== record.sourceSha256)
      throw new Error(`Canonical algorithm owner file hashes disagree: ${record.path}`)
    peers.push(record)
    canonicalOwnedByPath.set(record.path, peers)
    additionalNames.push(record.name)
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
    if (!runtimeSurfaceRoots.length)
      throw new Error('Trusted SC2 runtime surface roots are required')
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
          const ownedInFile = canonicalOwnedByPath.get(file) ?? []
          if (known && sha256(bytes) !== known.sha256Mk3)
            throw new Error(`Canonical algorithm copy hash mismatch: ${file}`)
          if (ownedInFile.length && sha256(bytes) !== ownedInFile[0].sourceSha256)
            throw new Error(`Canonical algorithm owner hash mismatch: ${file}`)
          const staged = copiedUnwiredByDestination.get(file) ?? []
          if (staged.length && staged.some(item => sha256(bytes) !== item.record.sha256Mk3))
            throw new Error(`Copied-unwired algorithm copy hash mismatch: ${file}`)
          for (const definition of algorithmDefinitions(
            bytes.toString('utf8'),
            file,
            additionalNames,
          )) {
            const temporary = copiedUnwired.get(`${file}:${definition.symbol}`)
            const owned = canonicalOwned.get(`${file}:${definition.symbol}`)
            if (temporary) temporary.hits++
            if (owned) owned.hits++
            implementations.push({
              id: `${file}:${definition.symbol}`,
              repository,
              path: file,
              ...definition,
              disposition: known
                ? 'canonical-copy'
                : owned
                  ? 'canonical-owned'
                  : temporary
                    ? 'copied-unwired-copy'
                    : 'existing-debt',
              ...(known
                ? { mk2Path: known.mk2Path }
                : owned
                  ? { reason: owned.record.reason }
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
      throw new Error(`Stale copied-unwired algorithm disposition: ${id} (found ${temporary.hits})`)
  for (const [id, owned] of canonicalOwned)
    if (owned.hits !== 1)
      throw new Error(`Stale canonical algorithm owner: ${id} (found ${owned.hits})`)
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
    if (
      row.disposition === 'canonical-copy' ||
      row.disposition === 'canonical-owned' ||
      row.disposition === 'copied-unwired-copy'
    )
      continue
    const old = previous.get(row.id)
    if (!old || old.disposition !== 'existing-debt')
      failures.push(`New undeclared algorithm implementation: ${row.id}`)
    else if (old.implementationSha256 !== row.implementationSha256)
      failures.push(`Existing algorithm debt changed without migration: ${row.id}`)
  }
  return {
    failures,
    debt: current.implementations.filter(row => row.disposition === 'existing-debt').length,
    canonical: current.implementations.filter(row => row.disposition.startsWith('canonical-'))
      .length,
    canonicalCopy: current.implementations.filter(row => row.disposition === 'canonical-copy')
      .length,
    canonicalOwned: current.implementations.filter(row => row.disposition === 'canonical-owned')
      .length,
    copiedUnwired: current.implementations.filter(row => row.disposition === 'copied-unwired-copy')
      .length,
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
